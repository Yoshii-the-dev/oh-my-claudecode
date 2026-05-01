import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync } from '../lib/atomic-write.js';

export type CreativeLoopStatus =
  | 'ready'
  | 'needs-brief'
  | 'needs-divergence'
  | 'needs-experiments'
  | 'needs-taste-gate';

export type CreativeLoopArtifactId =
  | 'meaning-brief'
  | 'inspiration-ledger'
  | 'visual-expectation'
  | 'design-directions'
  | 'motion-grammar'
  | 'token-system'
  | 'component-experiments'
  | 'taste-gate'
  | 'design-system';

export interface CreativeLoopArtifact {
  id: CreativeLoopArtifactId;
  path: string;
  required: boolean;
  exists: boolean;
  passed: boolean;
  reason: string;
}

export interface CreativeLoopPlan {
  schema_version: 1;
  produced_at: string;
  status: CreativeLoopStatus;
  goal?: string;
  artifacts: CreativeLoopArtifact[];
  missing_required: CreativeLoopArtifactId[];
  next_action: string;
  recommended_commands: string[];
}

export interface CreativeLoopOptions {
  root?: string;
  goal?: string;
  now?: Date;
}

export const CREATIVE_LOOP_JSON_RELATIVE_PATH = '.omc/design/creative-loop/current.json';
export const CREATIVE_LOOP_MD_RELATIVE_PATH = '.omc/design/creative-loop/current.md';
export const VISUAL_EXPECTATION_RELATIVE_PATH = '.omc/design/visual-expectation/current.json';
export const VISUAL_LIFECYCLE_JSON_RELATIVE_PATH = '.omc/design/visual-lifecycle/current.json';
export const VISUAL_LIFECYCLE_MD_RELATIVE_PATH = '.omc/design/visual-lifecycle/current.md';

export type VisualLifecycleStatus =
  | 'empty'
  | 'needs-hypothesis'
  | 'needs-implementation-map'
  | 'needs-screenshot-proof'
  | 'needs-iteration'
  | 'healthy';

export type VisualLifecyclePhaseId =
  | 'visual-hypothesis'
  | 'implementation-mapping'
  | 'screenshot-proof'
  | 'iteration-debt';

export type VisualLifecyclePhaseState =
  | 'missing'
  | 'partial'
  | 'ready'
  | 'blocking'
  | 'watchlist';

export interface VisualLifecyclePhase {
  id: VisualLifecyclePhaseId;
  state: VisualLifecyclePhaseState;
  evidence: string[];
  gaps: string[];
  recommended_action: string;
}

export interface VisualLifecycleDebt {
  severity: 'warning' | 'error';
  phase: VisualLifecyclePhaseId;
  subject: string;
  message: string;
  recommended_action: string;
  evidence: string[];
}

export interface VisualLifecycleReport {
  schema_version: 1;
  generated_at: string;
  root: string;
  status: VisualLifecycleStatus;
  goal?: string;
  source_artifacts: string[];
  aggregates: {
    phase_count: number;
    ready_phases: number;
    screenshot_proofs: number;
    iteration_debts: number;
    blocking_debts: number;
  };
  phases: VisualLifecyclePhase[];
  debts: VisualLifecycleDebt[];
  next_action: string;
}

const ARTIFACTS: Array<{
  id: CreativeLoopArtifactId;
  path: string;
  required: boolean;
  passTerms: string[];
}> = [
  {
    id: 'meaning-brief',
    path: '.omc/design/meaning-brief/current.md',
    required: true,
    passTerms: ['feeling', 'understanding', 'user state', 'product meaning'],
  },
  {
    id: 'inspiration-ledger',
    path: '.omc/design/inspiration-ledger/current.md',
    required: true,
    passTerms: ['principle', 'what not to copy', 'source', 'constraint'],
  },
  {
    id: 'visual-expectation',
    path: VISUAL_EXPECTATION_RELATIVE_PATH,
    required: true,
    passTerms: [],
  },
  {
    id: 'design-directions',
    path: '.omc/design/directions/current.md',
    required: true,
    passTerms: ['direction 1', 'direction 2', 'direction 3', 'hypothesis', 'tradeoff'],
  },
  {
    id: 'motion-grammar',
    path: '.omc/design/motion-grammar/current.md',
    required: true,
    passTerms: ['state', 'why', 'duration', 'easing', 'reduced motion'],
  },
  {
    id: 'token-system',
    path: '.omc/design/tokens/current.json',
    required: true,
    passTerms: ['color', 'type', 'spacing', 'radius', 'elevation', 'motion'],
  },
  {
    id: 'component-experiments',
    path: '.omc/design/component-experiments/current.json',
    required: true,
    passTerms: ['screenshot', 'visual_verdict', 'experiment'],
  },
  {
    id: 'taste-gate',
    path: '.omc/design/taste-gate/current.md',
    required: true,
    passTerms: ['verdict: pass', 'distinctiveness', 'usability', 'accessibility', 'brand fit'],
  },
  {
    id: 'design-system',
    path: '.omc/design/system/current.md',
    required: false,
    passTerms: ['component', 'token', 'usage'],
  },
];

export function planCreativeLoop(options: CreativeLoopOptions = {}): CreativeLoopPlan {
  const root = resolve(options.root ?? process.cwd());
  const artifacts = ARTIFACTS.map((artifact) => inspectArtifact(root, artifact));
  const missingRequired = artifacts
    .filter((artifact) => artifact.required && !artifact.passed)
    .map((artifact) => artifact.id);
  const status = creativeStatus(missingRequired);
  const commands = recommendedCommands(options.goal, status);

  return {
    schema_version: 1,
    produced_at: (options.now ?? new Date()).toISOString(),
    status,
    goal: options.goal,
    artifacts,
    missing_required: missingRequired,
    next_action: commands[0] ?? '/creative-loop "<visual goal>"',
    recommended_commands: commands,
  };
}

export function initCreativeLoop(options: CreativeLoopOptions = {}): CreativeLoopPlan {
  const root = resolve(options.root ?? process.cwd());
  for (const artifact of ARTIFACTS) {
    const path = resolve(root, artifact.path);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, templateFor(artifact.id, options.goal), 'utf-8');
  }
  const plan = planCreativeLoop(options);
  writeCreativeLoopPlan(root, plan);
  return plan;
}

export function writeCreativeLoopPlan(root = process.cwd(), plan: CreativeLoopPlan): {
  jsonPath: string;
  mdPath: string;
} {
  const jsonPath = resolve(root, CREATIVE_LOOP_JSON_RELATIVE_PATH);
  const mdPath = resolve(root, CREATIVE_LOOP_MD_RELATIVE_PATH);
  mkdirSync(dirname(jsonPath), { recursive: true });
  atomicWriteJsonSync(jsonPath, plan);
  atomicWriteFileSync(mdPath, renderCreativeLoopPlan(plan));
  return { jsonPath, mdPath };
}

export function generateVisualLifecycleReport(options: CreativeLoopOptions = {}): VisualLifecycleReport {
  const root = resolve(options.root ?? process.cwd());
  const plan = planCreativeLoop(options);
  const contract = readVisualExpectationContract(root);
  const phases = [
    visualHypothesisPhase(plan, contract),
    implementationMappingPhase(plan, contract),
    screenshotProofPhase(plan, contract),
  ];
  const debts = visualLifecycleDebts(plan, contract);
  phases.push(iterationDebtPhase(debts, contract));
  const sourceArtifacts = plan.artifacts
    .filter((artifact) => artifact.exists)
    .map((artifact) => artifact.path)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
  const status = visualLifecycleStatus(plan, phases, debts);

  return {
    schema_version: 1,
    generated_at: (options.now ?? new Date()).toISOString(),
    root,
    status,
    goal: options.goal,
    source_artifacts: sourceArtifacts,
    aggregates: {
      phase_count: phases.length,
      ready_phases: phases.filter((phase) => phase.state === 'ready' || phase.state === 'watchlist').length,
      screenshot_proofs: screenshotEvidence(contract).length,
      iteration_debts: debts.length,
      blocking_debts: debts.filter((debt) => debt.severity === 'error').length,
    },
    phases,
    debts,
    next_action: visualLifecycleNextAction(status),
  };
}

export function writeVisualLifecycleReport(
  root = process.cwd(),
  report = generateVisualLifecycleReport({ root }),
): { jsonPath: string; mdPath: string } {
  const jsonPath = resolve(root, VISUAL_LIFECYCLE_JSON_RELATIVE_PATH);
  const mdPath = resolve(root, VISUAL_LIFECYCLE_MD_RELATIVE_PATH);
  mkdirSync(dirname(jsonPath), { recursive: true });
  atomicWriteJsonSync(jsonPath, report);
  mkdirSync(dirname(mdPath), { recursive: true });
  atomicWriteFileSync(mdPath, renderVisualLifecycleReport(report));
  return { jsonPath, mdPath };
}

export function renderVisualLifecycleReport(report: VisualLifecycleReport): string {
  return [
    '# Visual Lifecycle',
    '',
    `status: ${report.status}`,
    `generated_at: ${report.generated_at}`,
    `goal: ${report.goal ?? 'unknown'}`,
    `schema_source: ${VISUAL_LIFECYCLE_JSON_RELATIVE_PATH}`,
    '',
    '## Aggregates',
    `- phase_count: ${report.aggregates.phase_count}`,
    `- ready_phases: ${report.aggregates.ready_phases}`,
    `- screenshot_proofs: ${report.aggregates.screenshot_proofs}`,
    `- iteration_debts: ${report.aggregates.iteration_debts}`,
    `- blocking_debts: ${report.aggregates.blocking_debts}`,
    '',
    '## Phases',
    '| Phase | State | Gaps | Recommended Action |',
    '| --- | --- | --- | --- |',
    ...report.phases.map((phase) => `| ${phase.id} | ${phase.state} | ${escapeCell(phase.gaps.join('; ') || 'none')} | ${escapeCell(phase.recommended_action)} |`),
    '',
    '## Iteration Debt',
    '| Severity | Phase | Subject | Recommended Action |',
    '| --- | --- | --- | --- |',
    ...(report.debts.length > 0
      ? report.debts.map((debt) => `| ${debt.severity} | ${debt.phase} | ${escapeCell(debt.subject)} | ${escapeCell(debt.recommended_action)} |`)
      : ['| warning | iteration-debt | none | No visual iteration debt detected |']),
    '',
    '## Source Artifacts',
    ...report.source_artifacts.map((source) => `- ${source}`),
    '',
    `next_action: ${report.next_action}`,
    '',
  ].join('\n');
}

export function renderCreativeLoopPlan(plan: CreativeLoopPlan): string {
  return [
    '# Creative Loop Readiness',
    '',
    `status: ${plan.status}`,
    `produced_at: ${plan.produced_at}`,
    `goal: ${plan.goal ?? 'unknown'}`,
    '',
    '## Artifacts',
    '| Artifact | Required | Passed | Path | Reason |',
    '| --- | --- | --- | --- | --- |',
    ...plan.artifacts.map((artifact) => [
      artifact.id,
      String(artifact.required),
      String(artifact.passed),
      artifact.path,
      escapeCell(artifact.reason),
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Missing Required',
    ...(plan.missing_required.length > 0 ? plan.missing_required.map((id) => `- ${id}`) : ['- none']),
    '',
    '## Recommended Commands',
    ...plan.recommended_commands.map((command) => `- \`${command}\``),
    '',
    `next_action: ${plan.next_action}`,
    '',
  ].join('\n');
}

export function shouldRunCreativeLoop(root = process.cwd()): boolean {
  return planCreativeLoop({ root }).status !== 'ready';
}

function inspectArtifact(
  root: string,
  artifact: (typeof ARTIFACTS)[number],
): CreativeLoopArtifact {
  const path = resolve(root, artifact.path);
  if (!existsSync(path)) {
    return {
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists: false,
      passed: false,
      reason: 'missing',
    };
  }

  const rawContent = readFileSync(path, 'utf-8');
  const content = rawContent.toLowerCase();
  if (isDraftPlaceholder(content)) {
    return {
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists: true,
      passed: false,
      reason: 'draft placeholder',
    };
  }

  if (artifact.id === 'visual-expectation') {
    const validation = validateVisualExpectationContract(root, rawContent);
    return {
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists: true,
      passed: validation.passed,
      reason: validation.reason,
    };
  }

  if (artifact.id === 'token-system') {
    const validation = validateTokenSystem(rawContent);
    return {
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists: true,
      passed: validation.passed,
      reason: validation.reason,
    };
  }

  if (artifact.id === 'component-experiments') {
    const validation = validateComponentExperiments(root, rawContent);
    return {
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists: true,
      passed: validation.passed,
      reason: validation.reason,
    };
  }

  const missingTerms = artifact.passTerms.filter((term) => !content.includes(term));
  if (artifact.id === 'taste-gate' && missingTerms.length === 0 && !/\b(screenshot|visual_verdict|visual verdict|evidence)\b/i.test(rawContent)) {
    missingTerms.push('visual evidence');
  }
  return {
    id: artifact.id,
    path: artifact.path,
    required: artifact.required,
    exists: true,
    passed: missingTerms.length === 0,
    reason: missingTerms.length === 0 ? 'present and passes minimum contract' : `missing terms: ${missingTerms.join(', ')}`,
  };
}

function isDraftPlaceholder(content: string): boolean {
  return /\bstatus:\s*draft\b/.test(content)
    || /"status"\s*:\s*"draft"/.test(content)
    || /<[^>\n]+>/.test(content);
}

function validateVisualExpectationContract(root: string, rawContent: string): { passed: boolean; reason: string } {
  const parsed = parseJsonObject(rawContent);
  if (!parsed) return { passed: false, reason: 'invalid json' };
  const contract = objectValue(parsed.visual_expectation_contract) ?? parsed;
  const missing: string[] = [];

  requireMeaningfulList(contract, 'desired_perception', missing);
  requireMeaningfulList(contract, 'category_codes_to_avoid', missing);
  requireMeaningfulList(contract, 'not_ready_if', missing);
  requireStringFields(objectValue(contract.selected_direction), 'selected_direction', ['name', 'rationale', 'tradeoffs'], missing);

  const inspirationPrinciples = arrayValue(contract.inspiration_principles);
  if (!inspirationPrinciples || inspirationPrinciples.length === 0) {
    missing.push('inspiration_principles');
  } else {
    for (const [index, entry] of inspirationPrinciples.entries()) {
      requireStringFields(objectValue(entry), `inspiration_principles[${index}]`, ['source', 'principle', 'what_not_to_copy'], missing);
    }
  }

  const tokenRationale = arrayValue(contract.token_rationale);
  if (!tokenRationale || tokenRationale.length === 0) {
    missing.push('token_rationale');
  } else {
    for (const [index, entry] of tokenRationale.entries()) {
      requireStringFields(objectValue(entry), `token_rationale[${index}]`, ['token', 'decision', 'reason'], missing);
    }
  }

  const componentProofs = arrayValue(contract.component_proofs);
  if (!componentProofs || componentProofs.length === 0) {
    missing.push('component_proofs');
  } else {
    for (const [index, entry] of componentProofs.entries()) {
      const proof = objectValue(entry);
      requireStringFields(proof, `component_proofs[${index}]`, ['component', 'state', 'screenshot', 'visual_verdict'], missing);
      if (proof && hasMeaningfulString(proof.screenshot) && !pathExists(root, proof.screenshot)) {
        missing.push(`component_proofs[${index}].screenshot file`);
      }
      if (proof && hasMeaningfulString(proof.visual_verdict) && !/\bpass\b/i.test(proof.visual_verdict)) {
        missing.push(`component_proofs[${index}].visual_verdict pass`);
      }
    }
  }

  const screenshots = stringArrayValue(contract.screenshot_evidence);
  if (screenshots.length === 0) {
    missing.push('screenshot_evidence');
  } else {
    for (const [index, screenshot] of screenshots.entries()) {
      if (!pathExists(root, screenshot)) missing.push(`screenshot_evidence[${index}] file`);
    }
  }

  return missing.length === 0
    ? { passed: true, reason: 'visual expectation contract passed' }
    : { passed: false, reason: `missing or invalid: ${missing.join(', ')}` };
}

function readVisualExpectationContract(root: string): Record<string, unknown> | undefined {
  const path = resolve(root, VISUAL_EXPECTATION_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseJsonObject(readFileSync(path, 'utf-8'));
    if (!parsed) return undefined;
    return objectValue(parsed.visual_expectation_contract) ?? parsed;
  } catch {
    return undefined;
  }
}

function visualHypothesisPhase(
  plan: CreativeLoopPlan,
  contract: Record<string, unknown> | undefined,
): VisualLifecyclePhase {
  const gaps: string[] = [];
  const direction = objectValue(contract?.selected_direction);
  if (!contract) gaps.push('visual expectation contract missing');
  if (stringArrayValue(contract?.desired_perception).length === 0) gaps.push('desired perception missing');
  if (stringArrayValue(contract?.category_codes_to_avoid).length === 0) gaps.push('category codes to avoid missing');
  if (!direction || !hasMeaningfulString(direction.name) || !hasMeaningfulString(direction.rationale)) {
    gaps.push('selected visual hypothesis missing');
  }
  if (!artifactPassed(plan, 'design-directions')) gaps.push('divergent design directions are not ready');

  return {
    id: 'visual-hypothesis',
    state: gaps.length === 0 ? 'ready' : contract ? 'partial' : 'missing',
    evidence: existingArtifactPaths(plan, ['visual-expectation', 'design-directions', 'meaning-brief', 'inspiration-ledger']),
    gaps,
    recommended_action: gaps.length === 0
      ? 'Use the selected direction as the visual hypothesis for implementation.'
      : 'Write a selected visual hypothesis grounded in meaning, category tension, and divergent directions.',
  };
}

function implementationMappingPhase(
  plan: CreativeLoopPlan,
  contract: Record<string, unknown> | undefined,
): VisualLifecyclePhase {
  const gaps: string[] = [];
  if (!arrayValue(contract?.token_rationale)?.length) gaps.push('token rationale missing');
  if (arrayValue(contract?.component_proofs)?.length) {
    for (const [index, proof] of arrayValue(contract?.component_proofs)!.entries()) {
      const record = objectValue(proof);
      if (!record || !hasMeaningfulString(record.component) || !hasMeaningfulString(record.state)) {
        gaps.push(`component proof ${index + 1} missing component/state mapping`);
      }
    }
  } else {
    gaps.push('component proofs missing');
  }
  if (!artifactPassed(plan, 'token-system')) gaps.push('token system is not ready');

  return {
    id: 'implementation-mapping',
    state: gaps.length === 0 ? 'ready' : contract ? 'partial' : 'missing',
    evidence: existingArtifactPaths(plan, ['visual-expectation', 'token-system', 'component-experiments', 'design-system']),
    gaps,
    recommended_action: gaps.length === 0
      ? 'Implementation has a component/token mapping to preserve the selected visual hypothesis.'
      : 'Map the selected direction into tokens, components, states, and component proofs before implementation is treated as visually complete.',
  };
}

function screenshotProofPhase(
  plan: CreativeLoopPlan,
  contract: Record<string, unknown> | undefined,
): VisualLifecyclePhase {
  const screenshots = screenshotEvidence(contract);
  const gaps: string[] = [];
  if (screenshots.length === 0) gaps.push('screenshot evidence missing');
  if (!artifactPassed(plan, 'component-experiments')) gaps.push('component experiments are not screenshot-proven');
  if (!artifactPassed(plan, 'taste-gate')) gaps.push('taste gate is not passing');

  return {
    id: 'screenshot-proof',
    state: gaps.length === 0 ? 'ready' : screenshots.length > 0 ? 'partial' : 'missing',
    evidence: [...existingArtifactPaths(plan, ['component-experiments', 'taste-gate']), ...screenshots],
    gaps,
    recommended_action: gaps.length === 0
      ? 'Screenshot proof and taste gate can be used as implementation evidence.'
      : 'Capture screenshots, run visual verdict, and pass the taste gate before calling the appearance done.',
  };
}

function iterationDebtPhase(
  debts: VisualLifecycleDebt[],
  contract: Record<string, unknown> | undefined,
): VisualLifecyclePhase {
  const blocking = debts.filter((debt) => debt.severity === 'error');
  const watchlist = stringArrayValue(contract?.not_ready_if);
  return {
    id: 'iteration-debt',
    state: blocking.length > 0 ? 'blocking' : watchlist.length > 0 || debts.length > 0 ? 'watchlist' : 'ready',
    evidence: [VISUAL_EXPECTATION_RELATIVE_PATH],
    gaps: debts.map((debt) => debt.subject),
    recommended_action: blocking.length > 0
      ? 'Resolve blocking visual debt before promoting the surface as visually complete.'
      : 'Carry not_ready_if conditions into the next design iteration as visual watchlist debt.',
  };
}

function visualLifecycleDebts(
  plan: CreativeLoopPlan,
  contract: Record<string, unknown> | undefined,
): VisualLifecycleDebt[] {
  const debts: VisualLifecycleDebt[] = [];
  for (const artifact of plan.artifacts.filter((entry) => entry.required && !entry.passed)) {
    debts.push({
      severity: 'error',
      phase: visualLifecyclePhaseForArtifact(artifact.id),
      subject: artifact.id,
      message: artifact.reason,
      recommended_action: `Repair ${artifact.id} before treating creative-loop as visually complete.`,
      evidence: artifact.exists ? [artifact.path] : [],
    });
  }
  for (const condition of stringArrayValue(contract?.not_ready_if)) {
    debts.push({
      severity: 'warning',
      phase: 'iteration-debt',
      subject: condition,
      message: 'Visual expectation contract names this as a future not-ready condition.',
      recommended_action: 'Re-check this condition after implementation screenshots exist.',
      evidence: [VISUAL_EXPECTATION_RELATIVE_PATH],
    });
  }
  return debts;
}

function visualLifecyclePhaseForArtifact(artifactId: CreativeLoopArtifactId): VisualLifecyclePhaseId {
  if (artifactId === 'token-system') return 'implementation-mapping';
  if (artifactId === 'component-experiments' || artifactId === 'taste-gate') return 'screenshot-proof';
  return 'visual-hypothesis';
}

function visualLifecycleStatus(
  plan: CreativeLoopPlan,
  phases: VisualLifecyclePhase[],
  debts: VisualLifecycleDebt[],
): VisualLifecycleStatus {
  if (!plan.artifacts.some((artifact) => artifact.exists)) return 'empty';
  if (phaseState(phases, 'visual-hypothesis') !== 'ready') return 'needs-hypothesis';
  if (phaseState(phases, 'implementation-mapping') !== 'ready') return 'needs-implementation-map';
  if (phaseState(phases, 'screenshot-proof') !== 'ready') return 'needs-screenshot-proof';
  if (debts.some((debt) => debt.severity === 'error')) return 'needs-iteration';
  return 'healthy';
}

function visualLifecycleNextAction(status: VisualLifecycleStatus): string {
  if (status === 'empty') return 'Run omc creative-loop init --goal "<visual goal>"';
  if (status === 'needs-hypothesis') return 'Write the visual hypothesis: meaning brief, inspiration ledger, selected direction, and divergence.';
  if (status === 'needs-implementation-map') return 'Map the selected direction into tokens, component states, and implementation proofs.';
  if (status === 'needs-screenshot-proof') return 'Capture screenshots, run visual verdict, and pass taste gate.';
  if (status === 'needs-iteration') return 'Resolve blocking visual iteration debt before promotion.';
  return 'Visual lifecycle is healthy; carry watchlist debt into future visual iterations.';
}

function phaseState(phases: VisualLifecyclePhase[], phaseId: VisualLifecyclePhaseId): VisualLifecyclePhaseState | undefined {
  return phases.find((phase) => phase.id === phaseId)?.state;
}

function artifactPassed(plan: CreativeLoopPlan, id: CreativeLoopArtifactId): boolean {
  return plan.artifacts.some((artifact) => artifact.id === id && artifact.passed);
}

function existingArtifactPaths(plan: CreativeLoopPlan, ids: CreativeLoopArtifactId[]): string[] {
  return plan.artifacts
    .filter((artifact) => ids.includes(artifact.id) && artifact.exists)
    .map((artifact) => artifact.path);
}

function screenshotEvidence(contract: Record<string, unknown> | undefined): string[] {
  return stringArrayValue(contract?.screenshot_evidence);
}

function validateTokenSystem(rawContent: string): { passed: boolean; reason: string } {
  const parsed = parseJsonObject(rawContent);
  if (!parsed) return { passed: false, reason: 'invalid json' };
  const required = ['color', 'type', 'spacing', 'radius', 'elevation', 'motion'];
  const missing = required.filter((field) => !hasNonEmptyStructuredValue(parsed[field]));
  return missing.length === 0
    ? { passed: true, reason: 'token system has meaningful required token groups' }
    : { passed: false, reason: `missing or empty token groups: ${missing.join(', ')}` };
}

function validateComponentExperiments(root: string, rawContent: string): { passed: boolean; reason: string } {
  const parsed = parseJsonObject(rawContent);
  if (!parsed) return { passed: false, reason: 'invalid json' };
  const missing: string[] = [];
  const experiments = stringArrayValue(parsed.experiment);
  const screenshots = stringArrayValue(parsed.screenshot);
  const verdicts = stringArrayValue(parsed.visual_verdict);
  if (experiments.length === 0) missing.push('experiment');
  if (screenshots.length === 0) {
    missing.push('screenshot');
  } else {
    for (const [index, screenshot] of screenshots.entries()) {
      if (!pathExists(root, screenshot)) missing.push(`screenshot[${index}] file`);
    }
  }
  if (verdicts.length === 0 || !verdicts.some((verdict) => /\bpass\b/i.test(verdict))) {
    missing.push('visual_verdict pass');
  }
  return missing.length === 0
    ? { passed: true, reason: 'component experiments include screenshot evidence and passing visual verdict' }
    : { passed: false, reason: `missing or invalid: ${missing.join(', ')}` };
}

function parseJsonObject(rawContent: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawContent);
    return objectValue(parsed);
  } catch {
    return undefined;
  }
}

function requireMeaningfulList(record: Record<string, unknown>, field: string, missing: string[]): void {
  if (stringArrayValue(record[field]).length === 0) missing.push(field);
}

function requireStringFields(
  record: Record<string, unknown> | undefined,
  prefix: string,
  fields: string[],
  missing: string[],
): void {
  if (!record) {
    missing.push(prefix);
    return;
  }
  for (const field of fields) {
    if (!hasMeaningfulString(record[field])) missing.push(`${prefix}.${field}`);
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(hasMeaningfulString);
  return hasMeaningfulString(value) ? [value] : [];
}

function hasMeaningfulString(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/^(?:tbd|todo|placeholder|pending|none|\[\])$/i.test(value.trim());
}

function hasNonEmptyStructuredValue(value: unknown): boolean {
  if (hasMeaningfulString(value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasNonEmptyStructuredValue);
  const record = objectValue(value);
  return record ? Object.values(record).some(hasNonEmptyStructuredValue) : false;
}

function pathExists(root: string, path: string): boolean {
  return existsSync(resolve(root, path));
}

function creativeStatus(missingRequired: CreativeLoopArtifactId[]): CreativeLoopStatus {
  if (
    missingRequired.includes('meaning-brief')
    || missingRequired.includes('inspiration-ledger')
    || missingRequired.includes('visual-expectation')
  ) {
    return 'needs-brief';
  }
  if (
    missingRequired.includes('design-directions')
    || missingRequired.includes('motion-grammar')
    || missingRequired.includes('token-system')
  ) {
    return 'needs-divergence';
  }
  if (missingRequired.includes('component-experiments')) {
    return 'needs-experiments';
  }
  if (missingRequired.includes('taste-gate')) {
    return 'needs-taste-gate';
  }
  return 'ready';
}

function recommendedCommands(goal: string | undefined, status: CreativeLoopStatus): string[] {
  const quotedGoal = JSON.stringify(goal ?? '<visual goal>');
  if (status === 'ready') return ['/product-pipeline "<core product slice>"'];
  if (status === 'needs-brief') return [`/creative-loop ${quotedGoal} --phase brief`];
  if (status === 'needs-divergence') return [`/creative-loop ${quotedGoal} --phase directions`];
  if (status === 'needs-experiments') return [`/creative-loop ${quotedGoal} --phase experiments`];
  return [`/creative-loop ${quotedGoal} --phase taste-gate`];
}

function templateFor(id: CreativeLoopArtifactId, goal: string | undefined): string {
  const title = goal ?? '<visual goal>';
  if (id === 'visual-expectation' || id === 'token-system' || id === 'component-experiments') {
    return `${JSON.stringify(templateJsonFor(id), null, 2)}\n`;
  }

  return [
    `# ${title}: ${id}`,
    '',
    'status: draft',
    '',
    templateBodyFor(id),
    '',
  ].join('\n');
}

function templateJsonFor(id: CreativeLoopArtifactId): Record<string, unknown> {
  if (id === 'visual-expectation') {
    return {
      schema_version: 1,
      status: 'draft',
      visual_expectation_contract: {
        desired_perception: [],
        category_codes_to_avoid: [],
        inspiration_principles: [],
        selected_direction: {
          name: '',
          rationale: '',
          tradeoffs: '',
        },
        token_rationale: [],
        component_proofs: [],
        screenshot_evidence: [],
        not_ready_if: [],
      },
    };
  }
  if (id === 'token-system') {
    return {
      schema_version: 1,
      status: 'draft',
      color: {},
      type: {},
      spacing: {},
      radius: {},
      elevation: {},
      motion: {},
    };
  }
  return {
    schema_version: 1,
    status: 'draft',
    experiment: [],
    screenshot: [],
    visual_verdict: [],
  };
}

function templateBodyFor(id: CreativeLoopArtifactId): string {
  switch (id) {
    case 'meaning-brief':
      return [
        '## Feeling',
        '<what the product should make the user feel>',
        '',
        '## Understanding',
        '<what the product should make clear>',
        '',
        '## User State',
        '<before / during / after state>',
        '',
        '## Product Meaning',
        '<semantic consequence for UI>',
      ].join('\n');
    case 'inspiration-ledger':
      return [
        '## Sources',
        '- source: <reference>',
        '  - principle: <what to extract>',
        '  - constraint: <where this principle applies>',
        '  - what not to copy: <signature details to avoid>',
      ].join('\n');
    case 'design-directions':
      return [
        '## Direction 1',
        'hypothesis: <visual hypothesis>',
        'tradeoff: <what this direction gains and loses>',
        '',
        '## Direction 2',
        'hypothesis: <visual hypothesis>',
        'tradeoff: <what this direction gains and loses>',
        '',
        '## Direction 3',
        'hypothesis: <visual hypothesis>',
        'tradeoff: <what this direction gains and loses>',
      ].join('\n');
    case 'motion-grammar':
      return [
        '## State Changes',
        '- state: <state>',
        '  - why: <user/product reason>',
        '  - duration: <ms>',
        '  - easing: <curve>',
        '  - reduced motion: <fallback>',
      ].join('\n');
    case 'taste-gate':
      return [
        'verdict: draft',
        '',
        '## Distinctiveness',
        '<score and evidence>',
        '',
        '## Usability',
        '<score and evidence>',
        '',
        '## Accessibility',
        '<score and evidence>',
        '',
        '## Brand Fit',
        '<score and evidence>',
      ].join('\n');
    case 'design-system':
      return [
        '## Components',
        '<components promoted after taste gate>',
        '',
        '## Tokens',
        '<token usage>',
        '',
        '## Usage',
        '<rules and examples>',
      ].join('\n');
    default:
      return '';
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

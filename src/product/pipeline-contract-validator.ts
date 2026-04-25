import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PRODUCT_ARTIFACT_PATHS,
  PRODUCT_STANDARD_FOOTER_FIELDS,
  type ProductPipelineArtifactName,
  type ProductPipelineContractStage,
} from './pipeline-registry.js';

export type {
  ProductPipelineArtifactName,
  ProductPipelineContractStage,
} from './pipeline-registry.js';

export type ProductPipelineIssueSeverity = 'error' | 'warning';

export interface ProductPipelineValidationIssue {
  severity: ProductPipelineIssueSeverity;
  artifact: ProductPipelineArtifactName;
  code: string;
  message: string;
}

export interface ProductPipelineArtifactResult {
  artifact: ProductPipelineArtifactName;
  path: string;
  exists: boolean;
  metrics: Record<string, number | string | boolean>;
  issues: ProductPipelineValidationIssue[];
}

export interface ProductPipelineValidationReport {
  ok: boolean;
  root: string;
  stage: ProductPipelineContractStage;
  artifacts: ProductPipelineArtifactResult[];
  issues: ProductPipelineValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export interface ValidateProductPipelineContractsOptions {
  root?: string;
  stage?: ProductPipelineContractStage;
}

interface ArtifactContract {
  artifact: ProductPipelineArtifactName;
  relativePath: string;
  required: boolean;
  validate: (content: string, result: ProductPipelineArtifactResult) => void;
}

export function validateProductPipelineContracts(
  options: ValidateProductPipelineContractsOptions = {},
): ProductPipelineValidationReport {
  const root = resolve(options.root ?? process.cwd());
  const stage = options.stage ?? 'foundation-lite';
  const contracts = buildContracts(stage);
  const artifacts = contracts.map((contract) => validateArtifact(root, contract));
  applyCrossArtifactContracts(root, stage, artifacts);
  const issues = artifacts.flatMap((artifact) => artifact.issues);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;

  return {
    ok: errors === 0,
    root,
    stage,
    artifacts,
    issues,
    summary: { errors, warnings },
  };
}

function buildContracts(stage: ProductPipelineContractStage): ArtifactContract[] {
  const capability = (required: boolean): ArtifactContract => ({
    artifact: 'capability-map',
    relativePath: PRODUCT_ARTIFACT_PATHS['capability-map'],
    required,
    validate: validateCapabilityMap,
  });
  const meaning = (required: boolean): ArtifactContract => ({
    artifact: 'meaning',
    relativePath: PRODUCT_ARTIFACT_PATHS.meaning,
    required,
    validate: validateMeaningGraph,
  });
  const ecosystem = (required: boolean): ArtifactContract => ({
    artifact: 'ecosystem',
    relativePath: PRODUCT_ARTIFACT_PATHS.ecosystem,
    required,
    validate: validateEcosystemMap,
  });
  const opportunities = (): ArtifactContract => ({
    artifact: 'opportunities',
    relativePath: PRODUCT_ARTIFACT_PATHS.opportunities,
    required: true,
    validate: validateOpportunities,
  });
  const portfolioLedger = (): ArtifactContract => ({
    artifact: 'portfolio-ledger',
    relativePath: PRODUCT_ARTIFACT_PATHS['portfolio-ledger'],
    required: true,
    validate: validatePortfolioLedgerArtifact,
  });
  const roadmap = (): ArtifactContract => ({
    artifact: 'roadmap',
    relativePath: PRODUCT_ARTIFACT_PATHS.roadmap,
    required: true,
    validate: validateRoadmap,
  });
  const cycle = (): ArtifactContract => ({
    artifact: 'cycle',
    relativePath: PRODUCT_ARTIFACT_PATHS.cycle,
    required: true,
    validate: validateCycle,
  });
  const experienceGate = (required: boolean): ArtifactContract => ({
    artifact: 'experience-gate',
    relativePath: PRODUCT_ARTIFACT_PATHS['experience-gate'],
    required,
    validate: validateExperienceGate,
  });
  const learning = (required: boolean): ArtifactContract => ({
    artifact: 'learning',
    relativePath: PRODUCT_ARTIFACT_PATHS.learning,
    required,
    validate: validateLearning,
  });

  if (stage === 'priority-handoff') {
    return [portfolioLedger(), opportunities(), roadmap()];
  }

  if (stage === 'technology-handoff') {
    return [capability(true), portfolioLedger(), opportunities(), roadmap()];
  }

  if (stage === 'cycle') {
    return [portfolioLedger(), opportunities(), roadmap(), cycle(), experienceGate(false), learning(false)];
  }

  if (stage === 'foundation-lite') {
    return [capability(true), meaning(false), ecosystem(true), portfolioLedger(), opportunities(), roadmap()];
  }

  return [capability(true), meaning(true), ecosystem(true), portfolioLedger(), opportunities(), roadmap(), cycle(), experienceGate(true), learning(true)];
}

function validateArtifact(root: string, contract: ArtifactContract): ProductPipelineArtifactResult {
  const path = resolve(root, contract.relativePath);
  const result: ProductPipelineArtifactResult = {
    artifact: contract.artifact,
    path,
    exists: existsSync(path),
    metrics: {},
    issues: [],
  };

  if (!result.exists) {
    addIssue(result, contract.required ? 'error' : 'warning', 'missing-artifact', `Missing ${contract.relativePath}`);
    return result;
  }

  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch (error) {
    addIssue(result, 'error', 'unreadable-artifact', `Cannot read ${contract.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  if (content.trim().length === 0) {
    addIssue(result, 'error', 'empty-artifact', `${contract.relativePath} is empty`);
    return result;
  }

  contract.validate(content, result);
  return result;
}

function applyCrossArtifactContracts(
  root: string,
  stage: ProductPipelineContractStage,
  artifacts: ProductPipelineArtifactResult[],
): void {
  if (stage !== 'cycle' && stage !== 'all') return;

  const cyclePath = resolve(root, PRODUCT_ARTIFACT_PATHS.cycle);
  const cycleContent = existsSync(cyclePath) ? safeRead(cyclePath) : '';
  const userFacing = isUserFacingCycle(cycleContent);
  let experience = artifacts.find((artifact) => artifact.artifact === 'experience-gate');

  if (userFacing && (!experience || !experience.exists)) {
    if (!experience) {
      experience = createVirtualArtifactResult('experience-gate', resolve(root, PRODUCT_ARTIFACT_PATHS['experience-gate']));
      artifacts.push(experience);
    }
    addIssue(
      experience,
      'error',
      'missing-experience-gate',
      'User-facing cycles must pass .omc/experience/current.md before build',
    );
  }

  const portfolioPath = resolve(root, PRODUCT_ARTIFACT_PATHS['portfolio-ledger']);
  const roadmapPath = resolve(root, PRODUCT_ARTIFACT_PATHS.roadmap);
  if (!existsSync(portfolioPath) || !existsSync(roadmapPath)) return;

  const researchDebt = portfolioHasSelectedResearchDebt(portfolioPath);
  const roadmapContent = safeRead(roadmapPath);
  const roadmap = artifacts.find((artifact) => artifact.artifact === 'roadmap');
  if (researchDebt && roadmap && !/\b(research debt|learning gate|research gate|learning\/research task)\b/i.test(roadmapContent)) {
    addIssue(
      roadmap,
      'error',
      'research-debt-missing-from-roadmap',
      'Weak evidence in selected work must be carried as research debt in the rolling roadmap',
    );
  }
}

function createVirtualArtifactResult(
  artifact: ProductPipelineArtifactName,
  path: string,
): ProductPipelineArtifactResult {
  return {
    artifact,
    path,
    exists: false,
    metrics: {},
    issues: [],
  };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function isUserFacingCycle(content: string): boolean {
  const route = extractBuildRoute(content);
  if (route === 'backend-pipeline') return false;
  if (route === 'product-pipeline' || route === 'both') return true;
  return containsAny(content, [
    'user journey',
    'user-facing',
    'user_visible: true',
    'reader',
    'editor',
    'onboarding',
    'screen',
  ]);
}

function portfolioHasSelectedResearchDebt(path: string): boolean {
  try {
    const ledger = JSON.parse(readFileSync(path, 'utf-8')) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(ledger.items) ? ledger.items : [];
    return items.some((item) => {
      const selected = typeof item.selected_cycle === 'string' && item.selected_cycle.length > 0;
      const weak = isWeakConfidence(item.confidence);
      const research = item.lane === 'research' || item.type === 'learning' || item.type === 'research';
      return selected && weak && !research;
    });
  } catch {
    return false;
  }
}

function validateCapabilityMap(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'capability-required-sections', [
    'MVP Feature Set',
    'First Usable Loop',
    'Required Product Systems',
    'Retention',
    'Launch Readiness',
    'Backend/Product Split',
  ]);

  if (hasRequestedNextAgent(content, 'technology-strategist') && !hasRequestedNextAgent(content, 'priority-engine')) {
    addIssue(
      result,
      'error',
      'technology-before-priority',
      'Capability map routes directly to technology-strategist without a priority-engine handoff',
    );
  }

  result.metrics.hasFirstUsableLoop = containsAny(content, ['first usable loop', 'usable loop']);
  validateHandoffBasics(content, result, false);
}

function validateMeaningGraph(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'meaning-required-sections', [
    'User Meanings',
    'Category Codes',
    'Enemy Moves',
    'Symbolic Assets',
    'Content Angles',
  ]);

  if (wordCount(content) > 1800) {
    addIssue(result, 'warning', 'meaning-too-long', 'Meaning graph is over 1800 words; keep it compact enough for downstream agents');
  }
}

function validateEcosystemMap(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'ecosystem-required-layers', [
    'app surfaces',
    'content loops',
    'data loops',
    'distribution loops',
    'integrations',
    'research loop',
  ]);
  requireTerms(result, content, 'ecosystem-depth-path', [
    'v0',
    'v1',
    'v2',
    'research gate',
  ]);
  validateStandardFooter(content, result);
}

function validateOpportunities(content: string, result: ProductPipelineArtifactResult): void {
  const status = extractStatus(content);
  const candidateCount = countCandidateMoves(content);
  const selectedPortfolioPresent = containsAll(content, [
    'core product slice',
    'enabling task',
    'learning',
  ]);
  const lanes = countKnownLanes(content);
  const minCandidates = status === 'needs-research' ? 12 : 20;

  result.metrics.status = status ?? 'unknown';
  result.metrics.candidateCount = candidateCount;
  result.metrics.laneCount = lanes;
  result.metrics.selectedPortfolioPresent = selectedPortfolioPresent;

  if (candidateCount < minCandidates) {
    addIssue(
      result,
      'error',
      'too-few-candidates',
      `Expected at least ${minCandidates} candidate moves for status=${status ?? 'unknown'}, found ${candidateCount}`,
    );
  }

  if (candidateCount > 40) {
    addIssue(result, 'error', 'too-many-candidates', `Expected at most 40 candidate moves, found ${candidateCount}`);
  }

  if (lanes < 5) {
    addIssue(result, 'error', `too-few-lanes`, `Expected candidate moves across at least 5 lanes, found ${lanes}`);
  }

  if (!selectedPortfolioPresent) {
    addIssue(result, 'error', 'missing-cycle-portfolio', 'Missing selected cycle portfolio with core product slice, enabling task, and learning/research task');
  }

  validateStandardFooter(content, result);
}

function validatePortfolioLedgerArtifact(content: string, result: ProductPipelineArtifactResult): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    addIssue(result, 'error', 'invalid-json', `Portfolio ledger is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    addIssue(result, 'error', 'invalid-portfolio-ledger', 'Portfolio ledger must be a JSON object');
    return;
  }

  const ledger = parsed as {
    schema_version?: unknown;
    updated_at?: unknown;
    source_artifacts?: unknown;
    items?: unknown;
  };

  if (ledger.schema_version !== 1) {
    addIssue(result, 'error', 'invalid-portfolio-schema', 'Portfolio ledger schema_version must be 1');
  }
  if (typeof ledger.updated_at !== 'string' || Number.isNaN(Date.parse(ledger.updated_at))) {
    addIssue(result, 'error', 'invalid-portfolio-updated-at', 'Portfolio ledger updated_at must be an ISO timestamp');
  }
  if (!Array.isArray(ledger.source_artifacts)) {
    addIssue(result, 'error', 'invalid-portfolio-sources', 'Portfolio ledger source_artifacts must be an array');
  }
  if (!Array.isArray(ledger.items)) {
    addIssue(result, 'error', 'invalid-portfolio-items', 'Portfolio ledger items must be an array');
    return;
  }

  const items = ledger.items as Array<Record<string, unknown>>;
  const lanes = new Set<string>();
  const selectedCycles = new Map<string, number>();
  const ids = new Set<string>();
  let evidenceBacked = 0;
  const selectedResearchByCycle = new Map<string, number>();
  const weakSelectedByCycle = new Map<string, number>();

  for (const [index, item] of items.entries()) {
    const id = item.id;
    const lane = item.lane;
    const status = item.status;
    const selectedCycle = item.selected_cycle;
    const evidence = item.evidence;
    const confidence = item.confidence;
    const type = item.type;

    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      addIssue(result, 'error', 'invalid-portfolio-id', `Portfolio item ${index} id must be kebab-case`);
    } else if (ids.has(id)) {
      addIssue(result, 'error', 'duplicate-portfolio-id', `Duplicate portfolio item id: ${id}`);
    } else {
      ids.add(id);
    }
    if (typeof lane === 'string') lanes.add(lane);
    if (typeof status !== 'string') {
      addIssue(result, 'error', 'invalid-portfolio-status', `Portfolio item ${id ?? index} status must be a string`);
    }
    if (!(Array.isArray(evidence) && evidence.length > 0)) {
      addIssue(result, 'error', 'missing-portfolio-evidence', `Portfolio item ${id ?? index} must include evidence`);
    } else {
      evidenceBacked += 1;
    }
    if (typeof selectedCycle === 'string' && selectedCycle.length > 0) {
      selectedCycles.set(selectedCycle, (selectedCycles.get(selectedCycle) ?? 0) + 1);
      if (lane === 'research' || type === 'learning' || type === 'research') {
        selectedResearchByCycle.set(selectedCycle, (selectedResearchByCycle.get(selectedCycle) ?? 0) + 1);
      }
      if (isWeakConfidence(confidence) && lane !== 'research' && type !== 'learning' && type !== 'research') {
        weakSelectedByCycle.set(selectedCycle, (weakSelectedByCycle.get(selectedCycle) ?? 0) + 1);
      }
    } else if (selectedCycle !== null) {
      addIssue(result, 'error', 'invalid-selected-cycle', `Portfolio item ${id ?? index} selected_cycle must be string or null`);
    }
  }

  result.metrics.itemCount = items.length;
  result.metrics.laneCount = lanes.size;
  result.metrics.evidenceBackedItems = evidenceBacked;
  result.metrics.selectedItems = [...selectedCycles.values()].reduce((total, count) => total + count, 0);

  if (items.length < 20) {
    addIssue(result, 'error', 'portfolio-too-small', `Expected at least 20 portfolio items, found ${items.length}`);
  }
  if (items.length > 40) {
    addIssue(result, 'error', 'portfolio-too-large', `Expected at most 40 portfolio items, found ${items.length}`);
  }
  if (lanes.size < 5) {
    addIssue(result, 'error', 'portfolio-too-few-lanes', `Expected portfolio items across at least 5 lanes, found ${lanes.size}`);
  }
  if (![...selectedCycles.values()].some((count) => count === 3)) {
    addIssue(result, 'error', 'missing-selected-cycle-trio', 'Portfolio ledger must select exactly three items for the next cycle');
  }
  for (const [cycle, count] of selectedCycles.entries()) {
    if (count > 3) {
      addIssue(result, 'warning', 'large-selected-cycle', `Cycle ${cycle} has ${count} selected items; expected core/enabling/learning trio`);
    }
  }
  for (const [cycle, count] of weakSelectedByCycle.entries()) {
    if ((selectedResearchByCycle.get(cycle) ?? 0) === 0) {
      addIssue(
        result,
        'error',
        'missing-research-debt-task',
        `Cycle ${cycle} has ${count} weak-confidence selected item(s) but no selected research/learning debt task`,
      );
    }
  }
}

function validateRoadmap(content: string, result: ProductPipelineArtifactResult): void {
  const hasTwoWeek = /(?:^|\b)(?:2|two)[ -]?(?:week|weeks)\b/i.test(content);
  const hasSixWeek = /(?:^|\b)(?:6|six)[ -]?(?:week|weeks)\b/i.test(content);
  const hasTwelveWeek = /(?:^|\b)(?:12|twelve)[ -]?(?:week|weeks)\b/i.test(content);

  result.metrics.hasTwoWeek = hasTwoWeek;
  result.metrics.hasSixWeek = hasSixWeek;
  result.metrics.hasTwelveWeek = hasTwelveWeek;

  if (!hasTwoWeek || !hasSixWeek || !hasTwelveWeek) {
    addIssue(result, 'error', 'missing-rolling-windows', 'Roadmap must include rolling 2/6/12-week windows');
  }

  if (/24[ -]?week/i.test(content)) {
    addIssue(result, 'warning', 'fixed-long-roadmap', 'Roadmap mentions 24-week planning; keep product roadmap rolling rather than fixed long-range planning');
  }

  validateStandardFooter(content, result);
}

function validateExperienceGate(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'experience-required-sections', [
    'User Journey',
    'Empty States',
    'Failure States',
    'Return Session',
    'Perceived Value',
    'UX Verdict',
  ]);

  if (!/\b(pass|passed|ok|ready-for-build)\b/i.test(content)) {
    addIssue(result, 'error', 'experience-gate-not-passed', 'Experience gate must explicitly pass before user-facing build');
  }

  validateStandardFooter(content, result);
}

function validateCycle(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'cycle-required-loop-stages', [
    'discover',
    'rank',
    'select',
    'spec',
    'build',
    'verify',
    'learn',
  ]);
  requireTerms(result, content, 'cycle-required-portfolio', [
    'core_product_slice',
    'enabling_task',
    'learning_task',
  ]);
  requireTerms(result, content, 'cycle-required-spec', [
    'acceptance_criteria',
    'build_route',
    'verification_plan',
    'learning_plan',
    'experience_gate',
  ]);

  const stage = extractCycleStage(content);
  result.metrics.cycleStage = stage ?? 'unknown';

  if (!stage) {
    addIssue(result, 'error', 'missing-cycle-stage', 'Cycle artifact must include cycle_stage');
  }

  if (stage === 'complete' && !containsTerm(content, '.omc/learning/current.md')) {
    addIssue(result, 'error', 'complete-without-learning', 'Completed cycle must reference .omc/learning/current.md');
  }

  validateStandardFooter(content, result);
}

function validateLearning(content: string, result: ProductPipelineArtifactResult): void {
  requireTerms(result, content, 'learning-required-sections', [
    'shipped outcome',
    'evidence collected',
    'user/product learning',
    'invalidated assumptions',
    'recommended next cycle',
  ]);
  validateStandardFooter(content, result);
}

function validateStandardFooter(content: string, result: ProductPipelineArtifactResult): void {
  const missing = PRODUCT_STANDARD_FOOTER_FIELDS.filter((field) => !content.includes(field));
  if (missing.length > 0) {
    addIssue(result, 'error', 'missing-standard-footer', `Missing standard footer fields: ${missing.join(', ')}`);
  }
}

function validateHandoffBasics(content: string, result: ProductPipelineArtifactResult, required: boolean): void {
  const hasHandoff = containsAll(content, ['run_id:', 'agent_role:', 'requested_next_agent:', 'artifacts_produced:']);
  result.metrics.hasHandoffEnvelope = hasHandoff;
  if (required && !hasHandoff) {
    addIssue(result, 'error', 'missing-handoff-envelope', 'Missing minimal handoff envelope fields');
  }
}

function requireTerms(
  result: ProductPipelineArtifactResult,
  content: string,
  code: string,
  terms: string[],
): void {
  const missing = terms.filter((term) => !containsTerm(content, term));
  if (missing.length > 0) {
    addIssue(result, 'error', code, `Missing required terms/sections: ${missing.join(', ')}`);
  }
}

function addIssue(
  result: ProductPipelineArtifactResult,
  severity: ProductPipelineIssueSeverity,
  code: string,
  message: string,
): void {
  result.issues.push({
    severity,
    artifact: result.artifact,
    code,
    message,
  });
}

function containsTerm(content: string, term: string): boolean {
  return content.toLowerCase().includes(term.toLowerCase());
}

function containsAny(content: string, terms: string[]): boolean {
  return terms.some((term) => containsTerm(content, term));
}

function containsAll(content: string, terms: string[]): boolean {
  return terms.every((term) => containsTerm(content, term));
}

function hasRequestedNextAgent(content: string, agent: string): boolean {
  return new RegExp(`requested_next_agent:\\s*['"]?${escapeRegExp(agent)}['"]?`, 'i').test(content);
}

function extractStatus(content: string): string | undefined {
  const match = content.match(/^\s*status:\s*([a-z-]+)/im);
  return match?.[1]?.toLowerCase();
}

function extractCycleStage(content: string): string | undefined {
  const match = content.match(/^\s*cycle_stage:\s*([a-z-]+)/im);
  return match?.[1]?.toLowerCase();
}

function extractBuildRoute(content: string): string | undefined {
  const match = content.match(/^\s*build_route:\s*([a-z-]+)/im);
  return match?.[1]?.toLowerCase();
}

function isWeakConfidence(value: unknown): boolean {
  if (typeof value === 'number') return value < 0.5;
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'low') return true;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric < 0.5;
}

function countCandidateMoves(content: string): number {
  const ids = new Set<string>();
  const idPattern = /^\s*(?:[-*]\s*)?(?:id|move_id|candidate_id)\s*:\s*([a-z0-9][a-z0-9-]+)/gim;
  for (const match of content.matchAll(idPattern)) {
    ids.add(match[1].toLowerCase());
  }

  const tableRows = content
    .split('\n')
    .filter((line) => isCandidateTableRow(line));

  return Math.max(ids.size, tableRows.length);
}

function isCandidateTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  if (/^\|[\s:-]+\|/.test(trimmed)) return false;
  if (/candidate|move|lane|evidence|confidence|expected/i.test(trimmed) && /---/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();
  const hasLane = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution']
    .some((lane) => lower.includes(`| ${lane}`) || lower.includes(`${lane} |`));
  const hasConfidence = /\|\s*(high|medium|low)\s*\|/i.test(trimmed);
  return hasLane && hasConfidence;
}

function countKnownLanes(content: string): number {
  const lower = content.toLowerCase();
  return [
    'product',
    'ux',
    'research',
    'backend',
    'quality',
    'brand-content',
    'distribution',
  ].filter((lane) => lower.includes(lane)).length;
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

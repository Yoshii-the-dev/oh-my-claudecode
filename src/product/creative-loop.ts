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
    passTerms: ['principle', 'what not to copy', 'source'],
  },
  {
    id: 'design-directions',
    path: '.omc/design/directions/current.md',
    required: true,
    passTerms: ['direction 1', 'direction 2', 'direction 3', 'hypothesis'],
  },
  {
    id: 'motion-grammar',
    path: '.omc/design/motion-grammar/current.md',
    required: true,
    passTerms: ['state', 'why', 'duration', 'easing'],
  },
  {
    id: 'token-system',
    path: '.omc/design/tokens/current.json',
    required: true,
    passTerms: ['color', 'type', 'spacing', 'radius', 'motion'],
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

  const missingTerms = artifact.passTerms.filter((term) => !content.includes(term));
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

function creativeStatus(missingRequired: CreativeLoopArtifactId[]): CreativeLoopStatus {
  if (missingRequired.includes('meaning-brief') || missingRequired.includes('inspiration-ledger')) {
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
  if (id === 'token-system' || id === 'component-experiments') {
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
        '  - what not to copy: <signature details to avoid>',
      ].join('\n');
    case 'design-directions':
      return [
        '## Direction 1',
        'hypothesis: <visual hypothesis>',
        '',
        '## Direction 2',
        'hypothesis: <visual hypothesis>',
        '',
        '## Direction 3',
        'hypothesis: <visual hypothesis>',
      ].join('\n');
    case 'motion-grammar':
      return [
        '## State Changes',
        '- state: <state>',
        '  - why: <user/product reason>',
        '  - duration: <ms>',
        '  - easing: <curve>',
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

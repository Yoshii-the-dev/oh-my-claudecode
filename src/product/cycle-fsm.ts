import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { validateProductPipelineContracts } from './pipeline-contract-validator.js';

export type ProductCycleStage =
  | 'discover'
  | 'rank'
  | 'select'
  | 'spec'
  | 'build'
  | 'verify'
  | 'learn'
  | 'complete'
  | 'blocked';

export interface ProductCycleIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ProductCycleSnapshot {
  exists: boolean;
  root: string;
  path: string;
  cycleId?: string;
  cycleGoal?: string;
  stage?: ProductCycleStage;
  productStage?: string;
  buildRoute?: string;
  nextStage?: ProductCycleStage;
  nextAction: string;
  issues: ProductCycleIssue[];
}

export interface ProductCycleAdvanceResult {
  ok: boolean;
  from?: ProductCycleStage;
  to: ProductCycleStage;
  snapshot: ProductCycleSnapshot;
  issues: ProductCycleIssue[];
}

export interface AdvanceProductCycleOptions {
  root?: string;
  to: ProductCycleStage;
  goal?: string;
  force?: boolean;
}

const CYCLE_RELATIVE_PATH = '.omc/cycles/current.md';
const LEARNING_RELATIVE_PATH = '.omc/learning/current.md';
const STAGES: ProductCycleStage[] = ['discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn', 'complete'];
const STAGE_SET = new Set<ProductCycleStage>([...STAGES, 'blocked']);

const NEXT_STAGE: Partial<Record<ProductCycleStage, ProductCycleStage>> = {
  discover: 'rank',
  rank: 'select',
  select: 'spec',
  spec: 'build',
  build: 'verify',
  verify: 'learn',
  learn: 'complete',
};

export function isProductCycleStage(value: string): value is ProductCycleStage {
  return STAGE_SET.has(value as ProductCycleStage);
}

export function getProductCyclePath(root = process.cwd()): string {
  return resolve(root, CYCLE_RELATIVE_PATH);
}

export function readProductCycle(root = process.cwd()): ProductCycleSnapshot {
  const resolvedRoot = resolve(root);
  const path = getProductCyclePath(resolvedRoot);
  if (!existsSync(path)) {
    return {
      exists: false,
      root: resolvedRoot,
      path,
      nextAction: 'Start a cycle: omc product-cycle advance --to discover --goal "<cycle goal>"',
      issues: [{
        severity: 'warning',
        code: 'missing-cycle',
        message: `Missing ${CYCLE_RELATIVE_PATH}`,
      }],
    };
  }

  const content = readFileSync(path, 'utf-8');
  const stage = parseStage(readField(content, 'cycle_stage'));
  const snapshot: ProductCycleSnapshot = {
    exists: true,
    root: resolvedRoot,
    path,
    cycleId: readField(content, 'cycle_id'),
    cycleGoal: readHeadingGoal(content) ?? readField(content, 'cycle_goal'),
    stage,
    productStage: readField(content, 'product_stage'),
    buildRoute: readField(content, 'build_route'),
    nextStage: stage ? NEXT_STAGE[stage] : undefined,
    nextAction: getNextAction(stage, content),
    issues: [],
  };

  if (!stage) {
    snapshot.issues.push({
      severity: 'error',
      code: 'missing-cycle-stage',
      message: 'Cycle artifact must include a valid cycle_stage field',
    });
  }

  return snapshot;
}

export function validateProductCycle(root = process.cwd()): ProductCycleSnapshot {
  const snapshot = readProductCycle(root);
  if (!snapshot.exists) return snapshot;

  const report = validateProductPipelineContracts({ root, stage: 'cycle' });
  for (const issue of report.issues) {
    snapshot.issues.push({
      severity: issue.severity,
      code: issue.code,
      message: `${issue.artifact}: ${issue.message}`,
    });
  }

  if (snapshot.stage === 'complete' && !existsSync(resolve(snapshot.root, LEARNING_RELATIVE_PATH))) {
    snapshot.issues.push({
      severity: 'error',
      code: 'complete-learning-missing',
      message: `Completed cycle requires ${LEARNING_RELATIVE_PATH}`,
    });
  }

  return snapshot;
}

export function advanceProductCycle(options: AdvanceProductCycleOptions): ProductCycleAdvanceResult {
  const root = resolve(options.root ?? process.cwd());
  const to = options.to;
  const before = readProductCycle(root);
  const issues: ProductCycleIssue[] = [];

  if (!before.exists) {
    if (to !== 'discover') {
      issues.push({
        severity: 'error',
        code: 'missing-cycle',
        message: `Cannot advance to ${to}; start with discover first`,
      });
      return { ok: false, to, snapshot: before, issues };
    }

    writeCycle(root, createCycleTemplate(options.goal ?? 'product learning cycle'));
    const created = readProductCycle(root);
    return { ok: true, to, snapshot: created, issues: [] };
  }

  if (!before.stage) {
    issues.push({
      severity: 'error',
      code: 'unknown-current-stage',
      message: 'Cannot advance because current cycle_stage is missing or invalid',
    });
    return { ok: false, to, snapshot: before, issues };
  }

  if (!options.force && !isLegalTransition(before.stage, to)) {
    issues.push({
      severity: 'error',
      code: 'illegal-transition',
      message: `Illegal transition ${before.stage} -> ${to}. Expected ${NEXT_STAGE[before.stage] ?? 'no automatic next stage'}`,
    });
  }

  issues.push(...transitionGuardIssues(root, before.stage, to));
  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, from: before.stage, to, snapshot: before, issues };
  }

  const content = readFileSync(before.path, 'utf-8');
  writeCycle(root, updateCycleStage(content, to));
  const after = readProductCycle(root);
  return { ok: true, from: before.stage, to, snapshot: after, issues };
}

export function getNextProductCycleAction(root = process.cwd()): ProductCycleSnapshot {
  return readProductCycle(root);
}

function transitionGuardIssues(root: string, from: ProductCycleStage, to: ProductCycleStage): ProductCycleIssue[] {
  const issues: ProductCycleIssue[] = [];

  if (from === 'rank' && to === 'select') {
    const report = validateProductPipelineContracts({ root, stage: 'priority-handoff' });
    if (!report.ok) {
      issues.push({
        severity: 'error',
        code: 'priority-contract-failed',
        message: 'Cannot select before priority-handoff contract passes',
      });
    }
  }

  if (from === 'spec' && to === 'build') {
    const report = validateProductPipelineContracts({ root, stage: 'cycle' });
    if (!report.ok) {
      issues.push({
        severity: 'error',
        code: 'cycle-contract-failed',
        message: 'Cannot build before cycle contract passes',
      });
    }
  }

  if (from === 'learn' && to === 'complete' && !existsSync(resolve(root, LEARNING_RELATIVE_PATH))) {
    issues.push({
      severity: 'error',
      code: 'learning-missing',
      message: `Cannot complete before ${LEARNING_RELATIVE_PATH} exists`,
    });
  }

  return issues;
}

function isLegalTransition(from: ProductCycleStage, to: ProductCycleStage): boolean {
  if (to === 'blocked') return from !== 'complete';
  return NEXT_STAGE[from] === to;
}

function writeCycle(root: string, content: string): void {
  const path = getProductCyclePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function createCycleTemplate(goal: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(goal);
  return `# Product Cycle: ${goal}

cycle_id: ${date}-${slug}
cycle_goal: ${goal}
cycle_stage: discover
product_stage: pre-mvp

## Stage Checklist
- [ ] discover
- [ ] rank
- [ ] select
- [ ] spec
- [ ] build
- [ ] verify
- [ ] learn

## Selected Cycle Portfolio
core_product_slice: TBD
enabling_task: TBD
learning_task: TBD

## Cycle Spec
acceptance_criteria:
  - TBD
build_route: blocked
verification_plan:
  - TBD
learning_plan:
  - TBD
experience_gate: .omc/experience/current.md

status: needs-research
evidence:
  - ${CYCLE_RELATIVE_PATH}
confidence: 0.2
blocking_issues:
  - discovery not complete
next_action: /product-foundation "${goal}" --foundation-lite
artifacts_written:
  - "${CYCLE_RELATIVE_PATH}"
`;
}

function updateCycleStage(content: string, stage: ProductCycleStage): string {
  let updated = content.match(/^\s*cycle_stage:/im)
    ? content.replace(/^\s*cycle_stage:\s*[a-z-]+/im, `cycle_stage: ${stage}`)
    : `${content.trimEnd()}\ncycle_stage: ${stage}\n`;

  for (const loopStage of STAGES.filter((item) => item !== 'complete')) {
    const checked = shouldCheckStage(loopStage, stage);
    const pattern = new RegExp(`^- \\[[ xX]\\] ${escapeRegExp(loopStage)}$`, 'm');
    if (pattern.test(updated)) {
      updated = updated.replace(pattern, `- [${checked ? 'x' : ' '}] ${loopStage}`);
    }
  }

  const nextAction = getNextAction(stage, updated);
  updated = updated.match(/^\s*next_action:/im)
    ? updated.replace(/^\s*next_action:\s*.*$/im, `next_action: ${nextAction}`)
    : `${updated.trimEnd()}\nnext_action: ${nextAction}\n`;

  if (stage === 'blocked') {
    updated = updated.match(/^\s*status:/im)
      ? updated.replace(/^\s*status:\s*.*$/im, 'status: blocked')
      : `${updated.trimEnd()}\nstatus: blocked\n`;
  } else if (stage === 'complete') {
    updated = updated.match(/^\s*status:/im)
      ? updated.replace(/^\s*status:\s*.*$/im, 'status: ok')
      : `${updated.trimEnd()}\nstatus: ok\n`;
  }

  return updated.endsWith('\n') ? updated : `${updated}\n`;
}

function shouldCheckStage(loopStage: ProductCycleStage, currentStage: ProductCycleStage): boolean {
  if (currentStage === 'complete') return true;
  if (currentStage === 'blocked') return false;
  const currentIndex = STAGES.indexOf(currentStage);
  const loopIndex = STAGES.indexOf(loopStage);
  return currentIndex >= loopIndex && currentIndex >= 0 && loopIndex >= 0;
}

function getNextAction(stage: ProductCycleStage | undefined, content: string): string {
  const goal = readHeadingGoal(content) ?? readField(content, 'cycle_goal') ?? '<cycle goal>';
  const buildRoute = readField(content, 'build_route') ?? 'blocked';

  switch (stage) {
    case 'discover':
      return `/product-foundation "${goal}" --foundation-lite`;
    case 'rank':
      return `/priority-engine "${goal}" && omc portfolio validate && omc doctor product-contracts --stage priority-handoff`;
    case 'select':
      return 'Select core_product_slice, enabling_task, and learning_task from .omc/portfolio/current.json';
    case 'spec':
      return 'Write acceptance_criteria, build_route, verification_plan, learning_plan, run /product-experience-gate, then run omc doctor product-contracts --stage cycle';
    case 'build':
      return buildRoute === 'backend-pipeline'
        ? '/backend-pipeline "<enabling task>"'
        : buildRoute === 'both'
          ? '/backend-pipeline "<enabling task>" then /product-pipeline "<core product slice>"'
          : '/product-pipeline "<core product slice>"';
    case 'verify':
      return 'Run tests/audits/verifier against cycle acceptance criteria';
    case 'learn':
      return `Write ${LEARNING_RELATIVE_PATH}, then run omc product-cycle advance --to complete`;
    case 'complete':
      return 'Cycle complete. Start the next cycle with omc product-cycle advance --to discover --goal "<next goal>" --force';
    case 'blocked':
      return 'Resolve blocking_issues, then advance with --force only when the blocker is explicitly cleared';
    default:
      return 'Start a cycle: omc product-cycle advance --to discover --goal "<cycle goal>"';
  }
}

function readField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^\\s*${escapeRegExp(field)}:\\s*(.+?)\\s*$`, 'im'));
  return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}

function readHeadingGoal(content: string): string | undefined {
  const match = content.match(/^#\s+Product Cycle:\s*(.+?)\s*$/im);
  return match?.[1]?.trim();
}

function parseStage(raw: string | undefined): ProductCycleStage | undefined {
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  return isProductCycleStage(normalized) ? normalized : undefined;
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'cycle';
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import type { ProductCycleSnapshot, ProductCycleStage } from './cycle-fsm.js';

export type ProductInterventionAgent =
  | 'product-foundation'
  | 'priority-engine'
  | 'product-experience-gate'
  | 'stack-provision'
  | 'backend-pipeline'
  | 'product-pipeline'
  | 'debugger'
  | 'executor'
  | 'test-engineer'
  | 'verifier'
  | 'ux-architect'
  | 'designer'
  | 'qa-tester';

export interface ProductInterventionRoute {
  id: string;
  agent: ProductInterventionAgent;
  trigger: string;
  purpose: string;
  required: boolean;
  command: string;
  blocksStage: boolean;
  evidence?: string[];
}

export interface ProductInterventionPlan {
  stage: ProductCycleStage;
  routes: ProductInterventionRoute[];
  blockingRoutes: ProductInterventionRoute[];
  nextCommand?: string;
}

export interface ProductInterventionHandoff {
  schema_version: 1;
  produced_at: string;
  agent_role: 'product-intervention-router';
  cycle_id?: string;
  cycle_goal?: string;
  cycle_stage: ProductCycleStage;
  status: 'blocked' | 'ready';
  next_command?: string;
  routes: ProductInterventionRoute[];
  blocking_route_count: number;
  context_consumed: string[];
}

export interface ProductInterventionHandoffWriteResult {
  jsonPath: string;
  mdPath: string;
}

export const PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH = '.omc/handoffs/product-cycle-interventions/current.json';

export interface PlanProductInterventionsOptions {
  root?: string;
  stage: ProductCycleStage;
  snapshot: ProductCycleSnapshot;
  failure?: {
    kind: 'verify-command-failed' | 'contract-failed';
    command?: string;
    reason?: string;
  };
}

const PRODUCT_BUILD_ROUTES = new Set(['product-pipeline', 'both']);

export function planProductInterventions(options: PlanProductInterventionsOptions): ProductInterventionPlan {
  const root = resolve(options.root ?? process.cwd());
  const routes: ProductInterventionRoute[] = [];

  if (options.stage === 'spec') {
    routes.push(...planSpecInterventions(root, options.snapshot));
  }

  if (options.stage === 'build') {
    routes.push(...planBuildInterventions(root, options.snapshot));
  }

  if (options.stage === 'verify' && options.failure) {
    routes.push(...planVerifyRepairInterventions(options.failure));
  }

  const blockingRoutes = routes.filter((route) => route.required && route.blocksStage);
  return {
    stage: options.stage,
    routes,
    blockingRoutes,
    nextCommand: blockingRoutes[0]?.command ?? routes.find((route) => route.required)?.command ?? routes[0]?.command,
  };
}

export function writeProductInterventionHandoff(
  root: string,
  snapshot: ProductCycleSnapshot,
  plan: ProductInterventionPlan,
): ProductInterventionHandoffWriteResult {
  const jsonRelativePath = PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH;
  const mdRelativePath = '.omc/handoffs/product-cycle-interventions/current.md';
  const jsonPath = resolve(root, jsonRelativePath);
  const mdPath = resolve(root, mdRelativePath);
  const handoff: ProductInterventionHandoff = {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-intervention-router',
    cycle_id: snapshot.cycleId,
    cycle_goal: snapshot.cycleGoal,
    cycle_stage: plan.stage,
    status: plan.blockingRoutes.length > 0 ? 'blocked' : 'ready',
    next_command: plan.nextCommand,
    routes: plan.routes,
    blocking_route_count: plan.blockingRoutes.length,
    context_consumed: interventionContext(plan),
  };

  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, handoff);
  atomicWriteFileSync(mdPath, renderProductInterventionHandoff(handoff));
  return { jsonPath, mdPath };
}

export function readProductInterventionHandoff(root = process.cwd()): ProductInterventionHandoff | undefined {
  const path = resolve(root, PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductInterventionHandoff;
}

function planSpecInterventions(root: string, snapshot: ProductCycleSnapshot): ProductInterventionRoute[] {
  if (!isUserFacingCycle(snapshot)) return [];

  const experienceRoute = planExperienceGateIntervention(root, snapshot);
  return experienceRoute ? [experienceRoute] : [];
}

function planExperienceGateIntervention(
  root: string,
  snapshot: ProductCycleSnapshot,
): ProductInterventionRoute | undefined {
  const experiencePath = '.omc/experience/current.md';
  const experienceContent = readRelative(root, experiencePath);
  const quality = evaluateExperienceGateQuality(experienceContent ?? '');
  if (quality.passed) return undefined;

  return {
    id: 'prebuild-experience-gate',
    agent: 'product-experience-gate',
    trigger: `user-facing cycle lacks a real passing experience gate: ${quality.reasons.join(', ')}`,
    purpose: 'Prove the concrete user journey, empty states, failure states, return session, perceived value, and build readiness before implementation.',
    required: true,
    command: `/product-experience-gate "${quoteArg(coreSliceOrGoal(snapshot))}"`,
    blocksStage: true,
    evidence: [experiencePath],
  };
}

function renderProductInterventionHandoff(handoff: ProductInterventionHandoff): string {
  const lines: string[] = [
    `# Product Cycle Interventions: ${handoff.cycle_goal ?? handoff.cycle_id ?? handoff.cycle_stage}`,
    '',
    `produced_at: ${handoff.produced_at}`,
    `cycle_id: ${handoff.cycle_id ?? 'unknown'}`,
    `cycle_stage: ${handoff.cycle_stage}`,
    `status: ${handoff.status}`,
    `blocking_route_count: ${handoff.blocking_route_count}`,
    `next_command: ${handoff.next_command ?? 'none'}`,
    '',
    '## Routes',
  ];

  if (handoff.routes.length === 0) {
    lines.push('- none');
  } else {
    for (const route of handoff.routes) {
      lines.push(`- ${route.required ? 'required' : 'recommended'} ${route.agent}: ${route.command}`);
      lines.push(`  - trigger: ${route.trigger}`);
      lines.push(`  - purpose: ${route.purpose}`);
      lines.push(`  - blocks_stage: ${route.blocksStage}`);
    }
  }

  lines.push('');
  lines.push('## Context Consumed');
  for (const path of handoff.context_consumed) {
    lines.push(`- ${path}`);
  }
  lines.push('');
  lines.push('artifacts_written:');
  lines.push('  - .omc/handoffs/product-cycle-interventions/current.json');
  lines.push('  - .omc/handoffs/product-cycle-interventions/current.md');
  lines.push('');

  return lines.join('\n');
}

function interventionContext(plan: ProductInterventionPlan): string[] {
  return Array.from(new Set(plan.routes.flatMap((route) => route.evidence ?? []))).sort();
}

function planBuildInterventions(root: string, snapshot: ProductCycleSnapshot): ProductInterventionRoute[] {
  const route = (snapshot.buildRoute ?? '').toLowerCase();
  const routes: ProductInterventionRoute[] = [];

  const experienceRoute = isUserFacingCycle(snapshot) ? planExperienceGateIntervention(root, snapshot) : undefined;
  if (experienceRoute) {
    routes.push(experienceRoute);
    return routes;
  }

  if (PRODUCT_BUILD_ROUTES.has(route) && needsVisualCreativeProvisioning(root, snapshot)) {
    const intent = coreSliceOrGoal(snapshot);
    routes.push({
      id: 'visual-creative-skill-provisioning',
      agent: 'stack-provision',
      trigger: 'user-facing build needs UX/visual capability coverage and no visual-creative provisioning manifest is present',
      purpose: 'Provision frontend-product and visual-creative skills for art direction, motion, generated assets, visual QA, and richer UI decisions before implementation.',
      required: true,
      command: `/stack-provision --surfaces=frontend-product,visual-creative --creative-intent="${quoteArg(intent)}"`,
      blocksStage: true,
      evidence: ['.omc/provisioned/current.json', '.omc/experience/current.md', '.omc/cycles/current.md'],
    });
  }

  if (route === 'backend-pipeline' || route === 'both') {
    routes.push({
      id: 'backend-build-pipeline',
      agent: 'backend-pipeline',
      trigger: `build_route=${route}`,
      purpose: 'Build the enabling/backend task through backend implementation and verification gates.',
      required: true,
      command: '/backend-pipeline "<enabling task>"',
      blocksStage: true,
      evidence: ['.omc/cycles/current.md'],
    });
  }

  if (route === 'product-pipeline' || route === 'both' || route === '') {
    routes.push({
      id: 'product-build-pipeline',
      agent: 'product-pipeline',
      trigger: `build_route=${route || 'unknown'}`,
      purpose: 'Build the core product slice through UX, designer/executor, quality, and verifier gates.',
      required: true,
      command: '/product-pipeline "<core product slice>"',
      blocksStage: true,
      evidence: ['.omc/cycles/current.md', '.omc/experience/current.md'],
    });
  }

  return routes;
}

function planVerifyRepairInterventions(failure: NonNullable<PlanProductInterventionsOptions['failure']>): ProductInterventionRoute[] {
  const trigger = failure.reason ?? failure.kind;
  const command = failure.command ? ` (${failure.command})` : '';
  return [
    {
      id: 'verify-root-cause',
      agent: 'debugger',
      trigger,
      purpose: `Find the root cause of the failed verification${command} before another implementation pass.`,
      required: true,
      command: '/prompts:debugger "root-cause the failed product-cycle verification and identify the smallest fix"',
      blocksStage: true,
    },
    {
      id: 'verify-minimal-fix',
      agent: 'executor',
      trigger,
      purpose: 'Apply the smallest code change that addresses the debugger root cause without broad refactors.',
      required: true,
      command: '/prompts:executor "apply the minimal repair from debugger findings"',
      blocksStage: true,
    },
    {
      id: 'verify-regression-coverage',
      agent: 'test-engineer',
      trigger,
      purpose: 'Add or update regression coverage for the failed path so the bug does not return.',
      required: true,
      command: '/prompts:test-engineer "add regression coverage for the product-cycle verification failure"',
      blocksStage: true,
    },
    {
      id: 'verify-final-approval',
      agent: 'verifier',
      trigger,
      purpose: 'Re-run acceptance evidence and approve or reject the repaired cycle.',
      required: true,
      command: '/prompts:verifier "verify the repaired product-cycle acceptance criteria and evidence"',
      blocksStage: true,
    },
  ];
}

function needsVisualCreativeProvisioning(root: string, snapshot: ProductCycleSnapshot): boolean {
  if (!isUserFacingCycle(snapshot)) return false;
  if (hasVisualCreativeProvisioning(root)) return false;
  return hasVisualCreativeSignal(root, snapshot);
}

function hasVisualCreativeProvisioning(root: string): boolean {
  const manifest = readRelative(root, '.omc/provisioned/current.json');
  if (!manifest) return false;
  return /\bvisual-creative\b|\bmeaning-driven-ui-builder\b|\bvisual-verdict\b|\bimagegen\b|\bcreative-direction\b/i.test(manifest);
}

function hasVisualCreativeSignal(root: string, snapshot: ProductCycleSnapshot): boolean {
  const corpus = [
    snapshot.cycleGoal,
    snapshot.buildRoute,
    readRelative(root, '.omc/cycles/current.md'),
    readRelative(root, '.omc/experience/current.md'),
    readRelative(root, '.omc/product/capability-map/current.md'),
    readRelative(root, '.omc/meaning/current.md'),
  ].filter(Boolean).join('\n').toLowerCase();

  return /\b(ui|ux|visual|interface|screen|dashboard|onboarding|empty state|error state|return session|flow|layout|brand|typography|motion|animation|icon|illustration|hero|canvas|3d|chart|graph|image|asset|style|theme)\b/i.test(corpus);
}

function isUserFacingCycle(snapshot: ProductCycleSnapshot): boolean {
  const route = (snapshot.buildRoute ?? '').toLowerCase();
  return PRODUCT_BUILD_ROUTES.has(route) || route === '';
}

function coreSliceOrGoal(snapshot: ProductCycleSnapshot): string {
  return snapshot.cycleGoal ?? 'core product slice';
}

function readRelative(root: string, relativePath: string): string | undefined {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

interface ExperienceGateQuality {
  passed: boolean;
  reasons: string[];
}

function evaluateExperienceGateQuality(content: string): ExperienceGateQuality {
  const reasons: string[] = [];
  if (!content.trim()) {
    return { passed: false, reasons: ['missing .omc/experience/current.md'] };
  }

  if (extractUxVerdict(content) !== 'pass') {
    reasons.push('UX Verdict is not pass');
  }

  const requiredSections = [
    ['User Journey', ['user', 'screen', 'flow', 'opens', 'sees', 'clicks', 'selects', 'continues']],
    ['Empty States', ['empty', 'no ', 'first', 'sample', 'placeholder', 'start']],
    ['Failure States', ['error', 'fail', 'recover', 'retry', 'invalid', 'offline']],
    ['Return Session', ['return', 'resume', 'reopen', 'continue', 'next']],
    ['Perceived Value', ['value', 'faster', 'clear', 'confidence', 'useful', 'less', 'easier']],
  ] as const;

  for (const [sectionName, terms] of requiredSections) {
    const section = extractSection(content, sectionName);
    if (!section) {
      reasons.push(`${sectionName} section missing`);
      continue;
    }
    const normalized = section.toLowerCase();
    if (normalized.replace(/\s+/g, ' ').trim().length < 60) {
      reasons.push(`${sectionName} section too thin`);
    }
    if (!terms.some((term) => normalized.includes(term))) {
      reasons.push(`${sectionName} lacks concrete product detail`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

function extractUxVerdict(content: string): string | undefined {
  const section = content.match(/(?:^|\n)#{1,6}\s*UX Verdict\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i)?.[1];
  const source = section ?? content;
  const firstMeaningfulLine = source
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .find((line) => line.length > 0 && !line.includes(':'));
  if (!firstMeaningfulLine) return undefined;
  const match = firstMeaningfulLine.match(/^(pass|blocked|needs-research)\b/);
  return match?.[1];
}

function extractSection(content: string, sectionName: string): string | undefined {
  return content.match(new RegExp(`(?:^|\\n)#{1,6}\\s*${escapeRegExp(sectionName)}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, 'i'))?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteArg(input: string): string {
  return input.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'core product slice';
}

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import { validateProductResearchArtifact, type ProductResearchArtifactValidationResult } from './research-artifact-validator.js';
import type { ProductCycleSnapshot, ProductCycleStage } from './cycle-fsm.js';

export type ProductResearchAgent =
  | 'stack-provision'
  | 'researcher'
  | 'dependency-expert'
  | 'ux-researcher'
  | 'designer'
  | 'product-manager'
  | 'product-analyst'
  | 'architect'
  | 'security-reviewer'
  | 'performance-reviewer';

export interface ProductResearchRoute {
  id: string;
  agent: ProductResearchAgent;
  trigger: string;
  purpose: string;
  required: boolean;
  command: string;
  blocksStage: boolean;
  evidence: string[];
  expectedArtifact: string;
}

export type ProductResearchScoreArea =
  | 'user-interaction'
  | 'dependency-api'
  | 'backend-architecture'
  | 'product-scope';

export interface ProductResearchScoreSignal {
  id: string;
  weight: number;
  matched: boolean;
  reason: string;
}

export interface ProductResearchScore {
  area: ProductResearchScoreArea;
  routeId: string;
  score: number;
  threshold: number;
  selected: boolean;
  reasons: string[];
  signals: ProductResearchScoreSignal[];
}

export interface ProductResearchScorecard {
  schema_version: 1;
  selectedRouteIds: string[];
  provisioningSurfaces: string[];
  scores: ProductResearchScore[];
}

export interface ProductResearchPlan {
  stage: ProductCycleStage;
  routes: ProductResearchRoute[];
  blockingRoutes: ProductResearchRoute[];
  nextCommand?: string;
  artifactValidation: ProductResearchArtifactValidationResult;
  scorecard: ProductResearchScorecard;
}

export interface ProductResearchHandoff {
  schema_version: 1;
  produced_at: string;
  agent_role: 'product-research-router';
  cycle_id?: string;
  cycle_goal?: string;
  cycle_stage: ProductCycleStage;
  status: 'blocked' | 'ready';
  next_command?: string;
  routes: ProductResearchRoute[];
  blocking_route_count: number;
  research_artifact: string;
  context_consumed: string[];
  scorecard?: ProductResearchScorecard;
}

export interface ProductResearchHandoffWriteResult {
  jsonPath: string;
  mdPath: string;
}

export interface PlanProductResearchOptions {
  root?: string;
  stage: ProductCycleStage;
  snapshot: ProductCycleSnapshot;
}

export const PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.json';
export const PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH = '.omc/research/product-cycle/current.md';

const PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.md';
const USER_FACING_BUILD_ROUTES = new Set(['product-pipeline', 'both', '']);

export function planProductResearch(options: PlanProductResearchOptions): ProductResearchPlan {
  const root = resolve(options.root ?? process.cwd());
  const routes: ProductResearchRoute[] = [];
  const corpus = researchCorpus(root, options.snapshot);
  const scorecard = scoreProductResearch({
    root,
    snapshot: options.snapshot,
    stage: options.stage,
    corpus,
  });
  const artifactValidation = validateProductResearchArtifact({
    root,
    expectedCycleId: options.snapshot.cycleId,
    expectedCycleStage: options.stage,
    expectedCycleGoal: options.snapshot.cycleGoal,
    userFacing: scorecard.selectedRouteIds.includes('user-interaction-research'),
    dependencySensitive: scorecard.selectedRouteIds.includes('dependency-api-research'),
    backendSensitive: scorecard.selectedRouteIds.includes('backend-architecture-research'),
    expectedRouteIds: scorecard.selectedRouteIds,
  });

  if ((options.stage === 'spec' || options.stage === 'build') && !artifactValidation.ok) {
    routes.push(...planStageResearch(root, options.snapshot, options.stage, artifactValidation, scorecard));
  }

  const blockingRoutes = routes.filter((route) => route.required && route.blocksStage);
  return {
    stage: options.stage,
    routes,
    blockingRoutes,
    nextCommand: blockingRoutes[0]?.command ?? routes.find((route) => route.required)?.command ?? routes[0]?.command,
    artifactValidation,
    scorecard,
  };
}

export function writeProductResearchHandoff(
  root: string,
  snapshot: ProductCycleSnapshot,
  plan: ProductResearchPlan,
): ProductResearchHandoffWriteResult {
  const jsonPath = resolve(root, PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH);
  const mdPath = resolve(root, PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH);
  const handoff: ProductResearchHandoff = {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-research-router',
    cycle_id: snapshot.cycleId,
    cycle_goal: snapshot.cycleGoal,
    cycle_stage: plan.stage,
    status: plan.blockingRoutes.length > 0 ? 'blocked' : 'ready',
    next_command: plan.nextCommand,
    routes: plan.routes,
    blocking_route_count: plan.blockingRoutes.length,
    research_artifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
    context_consumed: Array.from(new Set(plan.routes.flatMap((route) => route.evidence))).sort(),
    scorecard: plan.scorecard,
  };

  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, handoff);
  atomicWriteFileSync(mdPath, renderProductResearchHandoff(handoff));
  return { jsonPath, mdPath };
}

export function readProductResearchHandoff(root = process.cwd()): ProductResearchHandoff | undefined {
  const path = resolve(root, PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductResearchHandoff;
}

function planStageResearch(
  root: string,
  snapshot: ProductCycleSnapshot,
  stage: ProductCycleStage,
  validation: ProductResearchArtifactValidationResult,
  scorecard: ProductResearchScorecard,
): ProductResearchRoute[] {
  const routes: ProductResearchRoute[] = [];
  const artifactReason = researchArtifactReason(validation);

  const provisioningRoute = planResearchSkillProvisioning(root, snapshot, stage, scorecard);
  if (provisioningRoute) {
    routes.push(provisioningRoute);
  }

  const scoreReasons = scoreReasonByRoute(scorecard);

  if (scorecard.selectedRouteIds.includes('user-interaction-research')) {
    routes.push({
      id: 'user-interaction-research',
      agent: 'ux-researcher',
      trigger: `${stage} user interaction research score ${scoreReasons.get('user-interaction-research')}; invalid artifact: ${artifactReason}`,
      purpose: 'Research expected user interaction, workflow states, accessibility constraints, and real-world UI references before implementation choices.',
      required: true,
      command: `/prompts:ux-researcher "${quoteArg(`research UX patterns and states for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} for cycle_id ${snapshot.cycleId ?? 'unknown'} and cycle_stage ${stage} with Research Verdict pass/blocked, concrete sources, findings, applicability, decision constraints, risks, open questions, pass reason, user journey, empty/failure/loading states, return session, accessibility, and perceived value`)}"`,
      blocksStage: true,
      evidence: researchEvidencePaths(root),
      expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
    });
  }

  if (scorecard.selectedRouteIds.includes('dependency-api-research')) {
    routes.push({
      id: 'dependency-api-research',
      agent: 'dependency-expert',
      trigger: `${stage} dependency/API research score ${scoreReasons.get('dependency-api-research')}; invalid artifact: ${artifactReason}`,
      purpose: 'Check official documentation, current package/API behavior, constraints, and integration risks before choosing implementation details.',
      required: true,
      command: `/prompts:dependency-expert "${quoteArg(`research official docs and constraints for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} for cycle_id ${snapshot.cycleId ?? 'unknown'} and cycle_stage ${stage} with Research Verdict pass/blocked, concrete official sources, findings, applicability, decision constraints, risks, open questions, and pass reason`)}"`,
      blocksStage: true,
      evidence: researchEvidencePaths(root),
      expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
    });
  }

  if (scorecard.selectedRouteIds.includes('backend-architecture-research')) {
    routes.push({
      id: 'backend-architecture-research',
      agent: 'architect',
      trigger: `${stage} backend architecture research score ${scoreReasons.get('backend-architecture-research')}; invalid artifact: ${artifactReason}`,
      purpose: 'Research architectural constraints, data/API boundaries, security risks, and performance-sensitive decisions before backend implementation.',
      required: true,
      command: `/prompts:architect "${quoteArg(`research backend architecture constraints for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} for cycle_id ${snapshot.cycleId ?? 'unknown'} and cycle_stage ${stage} with Research Verdict pass/blocked, sources, findings, applicability, decision constraints, architecture/data/API boundary evidence, risks, open questions, and pass reason`)}"`,
      blocksStage: true,
      evidence: researchEvidencePaths(root),
      expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
    });
  }

  if (scorecard.selectedRouteIds.includes('product-scope-research')) {
    routes.push({
      id: 'product-scope-research',
      agent: 'product-manager',
      trigger: `product scope research score ${scoreReasons.get('product-scope-research')}; invalid artifact: ${artifactReason}`,
      purpose: 'Clarify user job, success criteria, anti-scope, and launch slice before implementation planning.',
      required: true,
      command: `/prompts:product-manager "${quoteArg(`research product usefulness and scope for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} for cycle_id ${snapshot.cycleId ?? 'unknown'} and cycle_stage ${stage} with Research Verdict pass/blocked, concrete sources, findings, applicability, decision constraints, risks, open questions, and pass reason`)}"`,
      blocksStage: true,
      evidence: researchEvidencePaths(root),
      expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
    });
  }

  return dedupeRoutes(routes);
}

function planResearchSkillProvisioning(
  root: string,
  snapshot: ProductCycleSnapshot,
  stage: ProductCycleStage,
  scorecard: ProductResearchScorecard,
): ProductResearchRoute | undefined {
  const surfaces = scorecard.provisioningSurfaces;
  if (surfaces.length === 0) return undefined;
  if (hasProvisioningForSurfaces(root, surfaces)) return undefined;

  const intent = coreSliceOrGoal(snapshot);
  return {
    id: 'research-skill-provisioning',
    agent: 'stack-provision',
    trigger: `${stage} research requires missing skill coverage for ${surfaces.join(', ')}`,
    purpose: 'Provision the product, visual, backend, or frontend research skill coverage before asking agents to make implementation-shaping research judgments.',
    required: true,
    command: `/stack-provision --surfaces=${surfaces.join(',')} --creative-intent="${quoteArg(intent)}"`,
    blocksStage: true,
    evidence: ['.omc/provisioned/current.json', '.omc/cycles/current.md', '.omc/experience/current.md'],
    expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
  };
}

function renderProductResearchHandoff(handoff: ProductResearchHandoff): string {
  const lines = [
    `# Product Cycle Research: ${handoff.cycle_goal ?? handoff.cycle_id ?? handoff.cycle_stage}`,
    '',
    `produced_at: ${handoff.produced_at}`,
    `cycle_id: ${handoff.cycle_id ?? 'unknown'}`,
    `cycle_stage: ${handoff.cycle_stage}`,
    `status: ${handoff.status}`,
    `blocking_route_count: ${handoff.blocking_route_count}`,
    `research_artifact: ${handoff.research_artifact}`,
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
      lines.push(`  - expected_artifact: ${route.expectedArtifact}`);
    }
  }

  lines.push('');
  lines.push('## Scorecard');
  if (!handoff.scorecard) {
    lines.push('- none');
  } else {
    for (const score of handoff.scorecard.scores) {
      lines.push(`- ${score.area}: ${score.score}/${score.threshold} selected=${score.selected}`);
      for (const reason of score.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
  }
  lines.push('');
  lines.push('## Context Consumed');
  for (const path of handoff.context_consumed) {
    lines.push(`- ${path}`);
  }
  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH}`);
  lines.push(`  - ${PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH}`);
  lines.push('');

  return lines.join('\n');
}

function researchCorpus(root: string, snapshot: ProductCycleSnapshot): string {
  return [
    snapshot.cycleGoal,
    snapshot.buildRoute,
    readRelative(root, '.omc/cycles/current.md'),
    readRelative(root, '.omc/experience/current.md'),
    readRelative(root, '.omc/product/capability-map/current.md'),
    readRelative(root, '.omc/ecosystem/current.md'),
    readRelative(root, '.omc/portfolio/current.json'),
    readRelative(root, '.omc/meaning/current.md'),
  ].filter(Boolean).join('\n').toLowerCase();
}

function researchArtifactReason(validation: ProductResearchArtifactValidationResult): string {
  if (!validation.exists) return 'artifact missing';
  const priority = new Map([
    ['research-verdict-not-pass', 0],
    ['missing-concrete-sources', 1],
    ['missing-sources', 2],
  ]);
  const errors = validation.issues
    .filter((issue) => issue.severity === 'error')
    .sort((left, right) => (priority.get(left.code) ?? 10) - (priority.get(right.code) ?? 10));
  return errors.slice(0, 5).map((issue) => issue.code).join(', ') || 'artifact did not pass validation';
}

function researchEvidencePaths(root: string): string[] {
  return [
    '.omc/cycles/current.md',
    '.omc/experience/current.md',
    '.omc/product/capability-map/current.md',
    '.omc/ecosystem/current.md',
    '.omc/portfolio/current.json',
    '.omc/meaning/current.md',
  ].filter((path) => existsSync(resolve(root, path)));
}

export interface ScoreProductResearchOptions {
  root: string;
  snapshot: ProductCycleSnapshot;
  stage: ProductCycleStage;
  corpus: string;
}

export function scoreProductResearch(options: ScoreProductResearchOptions): ProductResearchScorecard {
  const scores = [
    scoreUserInteractionResearch(options),
    scoreDependencyApiResearch(options),
    scoreBackendArchitectureResearch(options),
    scoreProductScopeResearch(options),
  ];
  const selectedRouteIds = scores
    .filter((score) => score.selected)
    .map((score) => score.routeId);
  const provisioningSurfaces = requiredResearchSurfaces(options.snapshot, options.corpus, selectedRouteIds);
  return {
    schema_version: 1,
    selectedRouteIds,
    provisioningSurfaces,
    scores,
  };
}

function scoreUserInteractionResearch(options: ScoreProductResearchOptions): ProductResearchScore {
  return makeScore('user-interaction', 'user-interaction-research', 5, [
    signal('user-facing-build-route', 3, isUserFacingCycle(options.snapshot), `build_route=${options.snapshot.buildRoute ?? 'unknown'} is user-facing`),
    signal('interaction-language', 2, /\b(ui|ux|interface|screen|dashboard|onboarding|form|table|flow|layout|navigation)\b/i.test(options.corpus), 'interaction or screen language found'),
    signal('state-language', 2, /\b(empty state|error state|failure state|loading|return session|resume|accessibility|a11y)\b/i.test(options.corpus), 'workflow state/accessibility language found'),
    signal('visual-product-language', 2, hasVisualCreativeResearchSignal(options.corpus), 'visual/product presentation language found'),
    signal('experience-artifact-present', 1, existsSync(resolve(options.root, '.omc/experience/current.md')), '.omc/experience/current.md is present'),
  ]);
}

function scoreDependencyApiResearch(options: ScoreProductResearchOptions): ProductResearchScore {
  return makeScore('dependency-api', 'dependency-api-research', 4, [
    signal('api-sdk-language', 2, /\b(sdk|api|library|framework|package|dependency|integration)\b/i.test(options.corpus), 'SDK/API/library dependency language found'),
    signal('named-technology', 2, /\b(stripe|supabase|firebase|openai|anthropic|next\.js|react|vue|svelte|expo|tailwind|shadcn|radix|postgres|redis|graphql|grpc|rest)\b/i.test(options.corpus), 'named technology or platform found'),
    signal('external-contract-language', 2, /\b(webhook|oauth|official docs|api reference|rate limit|billing|payment|auth provider)\b/i.test(options.corpus), 'external API contract language found'),
    signal('implementation-stage', 1, options.stage === 'spec' || options.stage === 'build', `stage=${options.stage} can be shaped by dependency research`),
  ]);
}

function scoreBackendArchitectureResearch(options: ScoreProductResearchOptions): ProductResearchScore {
  const route = (options.snapshot.buildRoute ?? '').toLowerCase();
  return makeScore('backend-architecture', 'backend-architecture-research', 5, [
    signal('backend-build-route', 3, route === 'backend-pipeline' || route === 'both', `build_route=${route || 'unknown'} includes backend`),
    signal('backend-domain-language', 2, /\b(backend|database|schema|migration|auth|authorization|authentication|permission|security|payment|billing)\b/i.test(options.corpus), 'backend/security/domain language found'),
    signal('operational-risk-language', 2, /\b(rate limit|queue|job|realtime|websocket|cache|latency|throughput|performance|multi-tenant|tenant|audit)\b/i.test(options.corpus), 'operational risk language found'),
    signal('data-boundary-language', 1, /\b(data boundary|api boundary|consistency|transaction|migration|schema)\b/i.test(options.corpus), 'data/API boundary language found'),
  ]);
}

function scoreProductScopeResearch(options: ScoreProductResearchOptions): ProductResearchScore {
  const noSpecialistScore = !isUserFacingCycle(options.snapshot)
    && !hasDependencyResearchSignal(options.corpus)
    && !hasBackendArchitectureSignal(options.corpus);
  return makeScore('product-scope', 'product-scope-research', 4, [
    signal('spec-stage', 2, options.stage === 'spec', 'spec stage needs usefulness and scope evidence'),
    signal('non-user-facing-route', 1, !isUserFacingCycle(options.snapshot), `build_route=${options.snapshot.buildRoute ?? 'unknown'} is not user-facing`),
    signal('weak-scope-language', 2, /\b(useful|scope|acceptance|criteria|first usable loop|learning|research debt|low confidence|weak evidence|proxy)\b/i.test(options.corpus), 'scope, acceptance, learning, or weak evidence language found'),
    signal('no-specialist-route', 2, noSpecialistScore, 'no UX, dependency, or backend research route scored high enough'),
  ]);
}

function makeScore(
  area: ProductResearchScoreArea,
  routeId: string,
  threshold: number,
  signals: ProductResearchScoreSignal[],
): ProductResearchScore {
  const score = signals.reduce((sum, entry) => sum + (entry.matched ? entry.weight : 0), 0);
  const reasons = signals.filter((entry) => entry.matched).map((entry) => `${entry.id}+${entry.weight}: ${entry.reason}`);
  return {
    area,
    routeId,
    score,
    threshold,
    selected: score >= threshold,
    reasons,
    signals,
  };
}

function signal(id: string, weight: number, matched: boolean, reason: string): ProductResearchScoreSignal {
  return { id, weight, matched, reason };
}

function scoreReasonByRoute(scorecard: ProductResearchScorecard): Map<string, string> {
  return new Map(scorecard.scores.map((score) => [
    score.routeId,
    `${score.score}/${score.threshold} (${score.reasons.join('; ') || 'no matched signals'})`,
  ]));
}

function requiredResearchSurfaces(
  snapshot: ProductCycleSnapshot,
  corpus: string,
  selectedRouteIds: string[],
): string[] {
  const surfaces = new Set<string>();
  if (selectedRouteIds.includes('user-interaction-research')) {
    surfaces.add('frontend-product');
    if (hasVisualCreativeResearchSignal(corpus)) {
      surfaces.add('visual-creative');
    }
  }
  if (selectedRouteIds.includes('backend-architecture-research')) {
    surfaces.add('backend');
  }
  if (selectedRouteIds.includes('dependency-api-research')) {
    if (hasFrontendEngineeringSignal(corpus)) surfaces.add('frontend-engineering');
    if (hasBackendArchitectureSignal(corpus)) surfaces.add('backend');
  }
  return Array.from(surfaces);
}

function hasProvisioningForSurfaces(root: string, surfaces: string[]): boolean {
  const manifest = readRelative(root, '.omc/provisioned/current.json');
  if (!manifest) return false;
  return surfaces.every((surface) => new RegExp(`\\b${escapeRegExp(surface)}\\b`, 'i').test(manifest));
}

function hasVisualCreativeResearchSignal(corpus: string): boolean {
  return /\b(visual|brand|typography|motion|animation|chart|graph|canvas|3d|illustration|icon|image|asset|style|theme|visual qa)\b/i.test(corpus);
}

function hasFrontendEngineeringSignal(corpus: string): boolean {
  return /\b(frontend|react|vue|svelte|next\.js|expo|tailwind|shadcn|radix|storybook|component|browser)\b/i.test(corpus);
}

function hasDependencyResearchSignal(corpus: string): boolean {
  return /\b(sdk|api|official docs|library|framework|package|dependency|integration|webhook|oauth|stripe|supabase|firebase|openai|anthropic|next\.js|react|vue|svelte|expo|tailwind|shadcn|radix|postgres|redis|graphql|grpc|rest)\b/i.test(corpus);
}

function hasBackendArchitectureSignal(corpus: string): boolean {
  return /\b(backend|database|schema|migration|auth|authorization|authentication|permission|security|payment|billing|rate limit|queue|job|realtime|websocket|cache|latency|throughput|performance|multi-tenant|tenant|audit)\b/i.test(corpus);
}

function isUserFacingCycle(snapshot: ProductCycleSnapshot): boolean {
  const route = (snapshot.buildRoute ?? '').toLowerCase();
  return USER_FACING_BUILD_ROUTES.has(route);
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

function dedupeRoutes(routes: ProductResearchRoute[]): ProductResearchRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.id)) return false;
    seen.add(route.id);
    return true;
  });
}

function quoteArg(input: string): string {
  return input.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) || 'product-cycle research';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import { validateProductResearchArtifact } from './research-artifact-validator.js';
export const PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.json';
export const PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH = '.omc/research/product-cycle/current.md';
const PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.md';
const USER_FACING_BUILD_ROUTES = new Set(['product-pipeline', 'both', '']);
export function planProductResearch(options) {
    const root = resolve(options.root ?? process.cwd());
    const routes = [];
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
export function writeProductResearchHandoff(root, snapshot, plan) {
    const jsonPath = resolve(root, PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH);
    const mdPath = resolve(root, PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH);
    const handoff = {
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
export function readProductResearchHandoff(root = process.cwd()) {
    const path = resolve(root, PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH);
    if (!existsSync(path))
        return undefined;
    return JSON.parse(readFileSync(path, 'utf-8'));
}
function planStageResearch(root, snapshot, stage, validation, scorecard) {
    const routes = [];
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
function planResearchSkillProvisioning(root, snapshot, stage, scorecard) {
    const surfaces = scorecard.provisioningSurfaces;
    if (surfaces.length === 0)
        return undefined;
    if (hasProvisioningForSurfaces(root, surfaces))
        return undefined;
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
function renderProductResearchHandoff(handoff) {
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
    }
    else {
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
    }
    else {
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
function researchCorpus(root, snapshot) {
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
function researchArtifactReason(validation) {
    if (!validation.exists)
        return 'artifact missing';
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
function researchEvidencePaths(root) {
    return [
        '.omc/cycles/current.md',
        '.omc/experience/current.md',
        '.omc/product/capability-map/current.md',
        '.omc/ecosystem/current.md',
        '.omc/portfolio/current.json',
        '.omc/meaning/current.md',
    ].filter((path) => existsSync(resolve(root, path)));
}
export function scoreProductResearch(options) {
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
function scoreUserInteractionResearch(options) {
    return makeScore('user-interaction', 'user-interaction-research', 5, [
        signal('user-facing-build-route', 3, isUserFacingCycle(options.snapshot), `build_route=${options.snapshot.buildRoute ?? 'unknown'} is user-facing`),
        signal('interaction-language', 2, /\b(ui|ux|interface|screen|dashboard|onboarding|form|table|flow|layout|navigation)\b/i.test(options.corpus), 'interaction or screen language found'),
        signal('state-language', 2, /\b(empty state|error state|failure state|loading|return session|resume|accessibility|a11y)\b/i.test(options.corpus), 'workflow state/accessibility language found'),
        signal('visual-product-language', 2, hasVisualCreativeResearchSignal(options.corpus), 'visual/product presentation language found'),
        signal('experience-artifact-present', 1, existsSync(resolve(options.root, '.omc/experience/current.md')), '.omc/experience/current.md is present'),
    ]);
}
function scoreDependencyApiResearch(options) {
    return makeScore('dependency-api', 'dependency-api-research', 4, [
        signal('api-sdk-language', 2, /\b(sdk|api|library|framework|package|dependency|integration)\b/i.test(options.corpus), 'SDK/API/library dependency language found'),
        signal('named-technology', 2, /\b(stripe|supabase|firebase|openai|anthropic|next\.js|react|vue|svelte|expo|tailwind|shadcn|radix|postgres|redis|graphql|grpc|rest)\b/i.test(options.corpus), 'named technology or platform found'),
        signal('external-contract-language', 2, /\b(webhook|oauth|official docs|api reference|rate limit|billing|payment|auth provider)\b/i.test(options.corpus), 'external API contract language found'),
        signal('implementation-stage', 1, options.stage === 'spec' || options.stage === 'build', `stage=${options.stage} can be shaped by dependency research`),
    ]);
}
function scoreBackendArchitectureResearch(options) {
    const route = (options.snapshot.buildRoute ?? '').toLowerCase();
    return makeScore('backend-architecture', 'backend-architecture-research', 5, [
        signal('backend-build-route', 3, route === 'backend-pipeline' || route === 'both', `build_route=${route || 'unknown'} includes backend`),
        signal('backend-domain-language', 2, /\b(backend|database|schema|migration|auth|authorization|authentication|permission|security|payment|billing)\b/i.test(options.corpus), 'backend/security/domain language found'),
        signal('operational-risk-language', 2, /\b(rate limit|queue|job|realtime|websocket|cache|latency|throughput|performance|multi-tenant|tenant|audit)\b/i.test(options.corpus), 'operational risk language found'),
        signal('data-boundary-language', 1, /\b(data boundary|api boundary|consistency|transaction|migration|schema)\b/i.test(options.corpus), 'data/API boundary language found'),
    ]);
}
function scoreProductScopeResearch(options) {
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
function makeScore(area, routeId, threshold, signals) {
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
function signal(id, weight, matched, reason) {
    return { id, weight, matched, reason };
}
function scoreReasonByRoute(scorecard) {
    return new Map(scorecard.scores.map((score) => [
        score.routeId,
        `${score.score}/${score.threshold} (${score.reasons.join('; ') || 'no matched signals'})`,
    ]));
}
function requiredResearchSurfaces(snapshot, corpus, selectedRouteIds) {
    const surfaces = new Set();
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
        if (hasFrontendEngineeringSignal(corpus))
            surfaces.add('frontend-engineering');
        if (hasBackendArchitectureSignal(corpus))
            surfaces.add('backend');
    }
    return Array.from(surfaces);
}
function hasProvisioningForSurfaces(root, surfaces) {
    const manifest = readRelative(root, '.omc/provisioned/current.json');
    if (!manifest)
        return false;
    return surfaces.every((surface) => new RegExp(`\\b${escapeRegExp(surface)}\\b`, 'i').test(manifest));
}
function hasVisualCreativeResearchSignal(corpus) {
    return /\b(visual|brand|typography|motion|animation|chart|graph|canvas|3d|illustration|icon|image|asset|style|theme|visual qa)\b/i.test(corpus);
}
function hasFrontendEngineeringSignal(corpus) {
    return /\b(frontend|react|vue|svelte|next\.js|expo|tailwind|shadcn|radix|storybook|component|browser)\b/i.test(corpus);
}
function hasDependencyResearchSignal(corpus) {
    return /\b(sdk|api|official docs|library|framework|package|dependency|integration|webhook|oauth|stripe|supabase|firebase|openai|anthropic|next\.js|react|vue|svelte|expo|tailwind|shadcn|radix|postgres|redis|graphql|grpc|rest)\b/i.test(corpus);
}
function hasBackendArchitectureSignal(corpus) {
    return /\b(backend|database|schema|migration|auth|authorization|authentication|permission|security|payment|billing|rate limit|queue|job|realtime|websocket|cache|latency|throughput|performance|multi-tenant|tenant|audit)\b/i.test(corpus);
}
function isUserFacingCycle(snapshot) {
    const route = (snapshot.buildRoute ?? '').toLowerCase();
    return USER_FACING_BUILD_ROUTES.has(route);
}
function coreSliceOrGoal(snapshot) {
    return snapshot.cycleGoal ?? 'core product slice';
}
function readRelative(root, relativePath) {
    const path = resolve(root, relativePath);
    if (!existsSync(path))
        return undefined;
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return undefined;
    }
}
function dedupeRoutes(routes) {
    const seen = new Set();
    return routes.filter((route) => {
        if (seen.has(route.id))
            return false;
        seen.add(route.id);
        return true;
    });
}
function quoteArg(input) {
    return input.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220) || 'product-cycle research';
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=research-router.js.map
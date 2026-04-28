import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
export const PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.json';
export const PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH = '.omc/research/product-cycle/current.md';
const PRODUCT_RESEARCH_HANDOFF_MD_RELATIVE_PATH = '.omc/handoffs/product-cycle-research/current.md';
const USER_FACING_BUILD_ROUTES = new Set(['product-pipeline', 'both', '']);
export function planProductResearch(options) {
    const root = resolve(options.root ?? process.cwd());
    const routes = [];
    if ((options.stage === 'spec' || options.stage === 'build') && !hasPassingResearchArtifact(root)) {
        routes.push(...planStageResearch(root, options.snapshot, options.stage));
    }
    const blockingRoutes = routes.filter((route) => route.required && route.blocksStage);
    return {
        stage: options.stage,
        routes,
        blockingRoutes,
        nextCommand: blockingRoutes[0]?.command ?? routes.find((route) => route.required)?.command ?? routes[0]?.command,
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
function planStageResearch(root, snapshot, stage) {
    const corpus = researchCorpus(root, snapshot);
    const routes = [];
    if (isUserFacingCycle(snapshot) && hasUxResearchSignal(corpus)) {
        routes.push({
            id: 'user-interaction-research',
            agent: 'ux-researcher',
            trigger: `${stage} user-facing feature has UX/interface signals but no passing product-cycle research artifact`,
            purpose: 'Research expected user interaction, workflow states, accessibility constraints, and real-world UI references before implementation choices.',
            required: true,
            command: `/prompts:ux-researcher "${quoteArg(`research UX patterns and states for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} with Research Verdict pass/blocked`)}"`,
            blocksStage: true,
            evidence: researchEvidencePaths(root),
            expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
        });
    }
    if (hasDependencyResearchSignal(corpus)) {
        routes.push({
            id: 'dependency-api-research',
            agent: 'dependency-expert',
            trigger: `${stage} references SDK/API/framework/library choices but no passing product-cycle research artifact`,
            purpose: 'Check official documentation, current package/API behavior, constraints, and integration risks before choosing implementation details.',
            required: true,
            command: `/prompts:dependency-expert "${quoteArg(`research official docs and constraints for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} with sources and Research Verdict pass/blocked`)}"`,
            blocksStage: true,
            evidence: researchEvidencePaths(root),
            expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
        });
    }
    if (hasBackendArchitectureSignal(corpus)) {
        routes.push({
            id: 'backend-architecture-research',
            agent: 'architect',
            trigger: `${stage} has backend/security/performance-sensitive signals but no passing product-cycle research artifact`,
            purpose: 'Research architectural constraints, data/API boundaries, security risks, and performance-sensitive decisions before backend implementation.',
            required: true,
            command: `/prompts:architect "${quoteArg(`research backend architecture constraints for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} with decision evidence and Research Verdict pass/blocked`)}"`,
            blocksStage: true,
            evidence: researchEvidencePaths(root),
            expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
        });
    }
    if (!isUserFacingCycle(snapshot) && routes.length === 0 && stage === 'spec') {
        routes.push({
            id: 'product-scope-research',
            agent: 'product-manager',
            trigger: 'spec stage lacks evidence that the selected slice is useful and correctly scoped',
            purpose: 'Clarify user job, success criteria, anti-scope, and launch slice before implementation planning.',
            required: true,
            command: `/prompts:product-manager "${quoteArg(`research product usefulness and scope for ${coreSliceOrGoal(snapshot)}; write ${PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH} with Research Verdict pass/blocked`)}"`,
            blocksStage: true,
            evidence: researchEvidencePaths(root),
            expectedArtifact: PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH,
        });
    }
    return dedupeRoutes(routes);
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
function hasPassingResearchArtifact(root) {
    const content = readRelative(root, PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH);
    if (!content)
        return false;
    const normalized = content.toLowerCase();
    return /research[_\s-]*verdict\s*:\s*pass\b/.test(normalized)
        || /(?:^|\n)#{1,6}\s*research verdict\s*\n\s*pass\b/.test(normalized);
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
function hasUxResearchSignal(corpus) {
    return /\b(ui|ux|interface|screen|dashboard|onboarding|form|table|empty state|error state|loading|return session|flow|layout|navigation|accessibility|a11y|visual|brand|typography|motion|animation|chart|graph|canvas|3d)\b/i.test(corpus);
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
//# sourceMappingURL=research-router.js.map
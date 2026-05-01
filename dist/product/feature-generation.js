import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { loadConfig } from '../config/loader.js';
import { inspectUnifiedMcpRegistrySync } from '../installer/mcp-registry.js';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
export const FEATURE_GENERATION_JSON_RELATIVE_PATH = '.omc/feature-generation/current.json';
export const FEATURE_GENERATION_MD_RELATIVE_PATH = '.omc/feature-generation/current.md';
const DEFAULT_STALE_AFTER_DAYS = 30;
const MIN_SOURCE_SCORE = 4;
const SOURCE_CANDIDATES = {
    vision: ['.omc/ideas/current.md', '.omc/specs/current.md', '.omc/constitution.md'],
    research: ['.omc/research/current.md', '.omc/digests/research-highlights.md'],
    competitors: ['.omc/competitors/landscape/current.md', '.omc/digests/competitors-landscape.md', '.omc/competitors/index.md'],
    meaning: ['.omc/meaning/current.md'],
    ecosystem: ['.omc/ecosystem/current.md'],
    'capability-map': ['.omc/product/capability-map/current.md'],
    'capability-graph': ['.omc/product/capability-graph/current.json', '.omc/product/capability-graph/current.md'],
    'scenario-generator': ['.omc/product/scenarios/current.json', '.omc/product/scenarios/current.md'],
    'scenario-coverage': ['.omc/product/scenario-coverage/current.json', '.omc/product/scenario-coverage/current.md'],
    regression: ['.omc/product/regression/current.json', '.omc/product/regression/current.md'],
    'capability-lifecycle': ['.omc/product/capability-lifecycle/current.json', '.omc/product/capability-lifecycle/current.md'],
    totality: ['.omc/product/totality/current.json', '.omc/product/totality/current.md'],
    learning: ['.omc/learning/current.md'],
    portfolio: ['.omc/portfolio/current.json', '.omc/opportunities/current.md', '.omc/roadmap/current.md'],
};
export function planFeatureGeneration(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const now = options.now ?? new Date();
    const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
    const mcpStatus = options.mcpStatus ?? inspectUnifiedMcpRegistrySync();
    const config = options.config ?? loadConfig();
    const sources = Object.keys(SOURCE_CANDIDATES)
        .map((kind) => inspectSource(root, kind, now, staleAfterDays));
    const mcp = buildMcpRecommendations(sources, mcpStatus, config);
    const sourceScore = scoreSources(sources);
    const blockers = buildBlockers(sources, sourceScore, options.goal);
    const missingRequiredMcp = mcp.filter((entry) => entry.required && !entry.configured);
    const status = blockers.length > 0
        ? 'blocked'
        : missingRequiredMcp.length > 0
            ? 'needs-mcp'
            : sourceScore < MIN_SOURCE_SCORE
                ? 'needs-input'
                : 'ready';
    const recommendedCommands = buildRecommendedCommands(options.goal, sources, missingRequiredMcp);
    return {
        schema_version: 1,
        produced_at: now.toISOString(),
        status,
        goal: options.goal,
        source_score: sourceScore,
        source_count: sources.filter((source) => source.status !== 'missing').length,
        required_source_count: MIN_SOURCE_SCORE,
        sources,
        mcp,
        recommended_commands: recommendedCommands,
        blockers,
        next_action: recommendedCommands[0] ?? '/priority-engine "<cycle goal>"',
    };
}
export function writeFeatureGenerationPlan(root = process.cwd(), plan) {
    const jsonPath = resolve(root, FEATURE_GENERATION_JSON_RELATIVE_PATH);
    const mdPath = resolve(root, FEATURE_GENERATION_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, plan);
    writeFileSync(mdPath, renderFeatureGenerationPlan(plan), 'utf-8');
    return { jsonPath, mdPath };
}
export function renderFeatureGenerationPlan(plan) {
    const lines = [
        '# Feature Generation Readiness',
        '',
        `status: ${plan.status}`,
        `produced_at: ${plan.produced_at}`,
        `goal: ${plan.goal ?? 'unknown'}`,
        `source_score: ${plan.source_score}/${plan.required_source_count}`,
        '',
        '## Sources',
        '| Kind | Status | Path | Reason |',
        '| --- | --- | --- | --- |',
        ...plan.sources.map((source) => `| ${source.kind} | ${source.status} | ${source.path} | ${escapeCell(source.reason)} |`),
        '',
        '## MCP',
        '| Server | Configured | Required | Purpose | Setup |',
        '| --- | --- | --- | --- | --- |',
        ...plan.mcp.map((entry) => `| ${entry.server} | ${entry.configured} | ${entry.required} | ${escapeCell(entry.purpose)} | \`${entry.setup}\` |`),
        '',
        '## Blockers',
        ...(plan.blockers.length > 0 ? plan.blockers.map((blocker) => `- ${blocker}`) : ['- none']),
        '',
        '## Recommended Commands',
        ...plan.recommended_commands.map((command) => `- \`${command}\``),
        '',
        `next_action: ${plan.next_action}`,
        '',
    ];
    return lines.join('\n');
}
function inspectSource(root, kind, now, staleAfterDays) {
    const candidates = SOURCE_CANDIDATES[kind];
    const found = candidates.find((candidate) => existsSync(resolve(root, candidate)));
    if (!found) {
        return {
            kind,
            path: candidates[0],
            status: 'missing',
            reason: `Missing ${kind} context`,
        };
    }
    const absolutePath = resolve(root, found);
    const stats = statSync(absolutePath);
    const ageDays = Math.max(0, Math.floor((now.getTime() - stats.mtimeMs) / 86_400_000));
    const content = readFileSync(absolutePath, 'utf-8');
    const chars = content.trim().length;
    if (chars < 120) {
        return { kind, path: found, status: 'thin', ageDays, chars, reason: `${kind} artifact is too thin (${chars} chars)` };
    }
    if ((kind === 'research' || kind === 'competitors' || kind === 'learning') && ageDays > staleAfterDays) {
        return { kind, path: found, status: 'stale', ageDays, chars, reason: `${kind} artifact is ${ageDays} days old` };
    }
    return { kind, path: found, status: 'present', ageDays, chars, reason: `${kind} context present` };
}
function scoreSources(sources) {
    return sources.reduce((sum, source) => {
        if (source.status === 'present')
            return sum + 1;
        if (source.status === 'thin' || source.status === 'stale')
            return sum + 0.5;
        return sum;
    }, 0);
}
function buildMcpRecommendations(sources, status, config) {
    const serverNames = new Set(status.serverNames);
    const source = (kind) => sources.find((entry) => entry.kind === kind);
    const needsExternalRefresh = source('competitors')?.status !== 'present' || source('research')?.status !== 'present';
    const needsDocsRefresh = source('capability-map')?.status === 'present' || source('ecosystem')?.status === 'present';
    return [
        {
            server: 'linkup',
            configured: serverNames.has('linkup'),
            required: Boolean(config.mcpServers?.linkup?.enabled !== false && needsExternalRefresh),
            purpose: 'Fresh web/category/source discovery for competitor moves, market whitespace, and feature inspiration.',
            setup: '/mcp-setup -> Linkup Web Search',
        },
        {
            server: 'ref',
            configured: serverNames.has('ref'),
            required: Boolean(config.mcpServers?.ref?.enabled !== false && needsDocsRefresh),
            purpose: 'Official documentation context for framework/API-dependent feature and simulator decisions.',
            setup: '/mcp-setup -> Ref',
        },
        {
            server: 'github',
            configured: serverNames.has('github'),
            required: false,
            purpose: 'Optional repository issue/PR feedback, roadmap signals, and release-risk checks.',
            setup: '/mcp-setup -> GitHub',
        },
        {
            server: 'company-context',
            configured: Boolean(config.companyContext?.tool),
            required: false,
            purpose: 'Optional internal/company context provider via get_company_context convention.',
            setup: '/mcp-setup -> Custom server, then set companyContext.tool',
        },
    ];
}
function buildBlockers(sources, sourceScore, goal) {
    const blockers = [];
    const hasVision = sources.find((source) => source.kind === 'vision')?.status !== 'missing';
    const hasCapability = sources.find((source) => source.kind === 'capability-map')?.status !== 'missing';
    if (!goal && !hasVision && !hasCapability) {
        blockers.push('No goal, vision, idea, spec, constitution, or capability map is available.');
    }
    if (sourceScore < 2) {
        blockers.push('Feature generation has fewer than two usable evidence sources.');
    }
    return blockers;
}
function buildRecommendedCommands(goal, sources, missingRequiredMcp) {
    const quotedGoal = JSON.stringify(goal ?? '<cycle goal>');
    const commands = [];
    if (missingRequiredMcp.length > 0) {
        commands.push(`/mcp-setup # configure ${missingRequiredMcp.map((entry) => entry.server).join(', ')}`);
    }
    if (sources.find((source) => source.kind === 'vision')?.status === 'missing') {
        commands.push(`/ideate ${quotedGoal}`);
    }
    if (sources.find((source) => source.kind === 'competitors')?.status !== 'present') {
        commands.push(`/competitor-scout ${quotedGoal} --refresh`);
    }
    if (sources.find((source) => source.kind === 'ecosystem')?.status === 'missing') {
        commands.push(`/prompts:product-ecosystem-architect ${quotedGoal}`);
    }
    commands.push(`/priority-engine ${quotedGoal}`);
    return commands;
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=feature-generation.js.map
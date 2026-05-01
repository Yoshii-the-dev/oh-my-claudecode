import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import { PRODUCT_TOTALITY_JSON_RELATIVE_PATH, generateProductTotalityAudit, } from './product-totality.js';
import { PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH, generateProductScenarioCoverageAudit, } from './scenario-coverage.js';
import { PRODUCT_REGRESSION_JSON_RELATIVE_PATH, generateProductRegressionAudit, } from './product-regression.js';
export const PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH = '.omc/product/capability-lifecycle/current.json';
export const PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH = '.omc/product/capability-lifecycle/current.md';
export const PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH = '.omc/product/capability-lifecycle/history.json';
export const PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_MD_RELATIVE_PATH = '.omc/product/capability-lifecycle/history.md';
export function generateProductCapabilityLifecycleAudit(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const totality = options.totality ?? generateProductTotalityAudit(root);
    const scenarioCoverage = options.scenarioCoverage ?? generateProductScenarioCoverageAudit({ root, totality });
    const regression = options.regression ?? generateProductRegressionAudit({ root, totality, scenarioCoverage });
    const lifecycleContext = readLifecycleContext(root);
    const items = totality.capabilities.map((capability) => lifecycleItem(capability, totality, scenarioCoverage, regression, lifecycleContext));
    const status = determineStatus(items);
    const sourceArtifacts = Array.from(new Set([
        PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
        PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH,
        PRODUCT_REGRESSION_JSON_RELATIVE_PATH,
        ...totality.source_artifacts,
        ...scenarioCoverage.source_artifacts,
        ...regression.source_artifacts,
        ...lifecycleContext.sources,
    ])).sort();
    return {
        schema_version: 1,
        generated_at: (options.now ?? new Date()).toISOString(),
        root,
        status,
        source_artifacts: sourceArtifacts,
        aggregates: {
            capability_count: items.length,
            seeded: items.filter((item) => item.stage === 'seeded').length,
            proving: items.filter((item) => item.stage === 'proving').length,
            connected: items.filter((item) => item.stage === 'connected').length,
            mature: items.filter((item) => item.stage === 'mature').length,
            deprecated: items.filter((item) => item.stage === 'deprecated').length,
            remove_candidates: items.filter((item) => item.stage === 'remove-candidate').length,
            error_debt_capabilities: items.filter((item) => item.error_debt_count > 0).length,
        },
        capabilities: items,
        next_action: nextAction(status),
    };
}
export function writeProductCapabilityLifecycleAudit(root = process.cwd(), report = generateProductCapabilityLifecycleAudit({ root }), history = generateProductCapabilityLifecycleHistory({ root, current: report })) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, report);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductCapabilityLifecycleAudit(report), 'utf-8');
    const historyWritten = writeProductCapabilityLifecycleHistory(resolvedRoot, history);
    return {
        jsonPath,
        mdPath,
        historyJsonPath: historyWritten.jsonPath,
        historyMdPath: historyWritten.mdPath,
    };
}
export function readProductCapabilityLifecycleHistory(root = process.cwd()) {
    const path = resolve(root, PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH);
    if (!existsSync(path))
        return undefined;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return parsed?.schema_version === 1 && Array.isArray(parsed.events) && Array.isArray(parsed.capabilities)
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
export function generateProductCapabilityLifecycleHistory(options) {
    const root = resolve(options.root ?? options.current.root ?? process.cwd());
    const recordedAt = (options.now ?? new Date()).toISOString();
    const previous = options.previous ?? readProductCapabilityLifecycleHistory(root);
    const previousEvents = previous?.events ?? [];
    const previousStateByCapability = new Map();
    for (const capability of previous?.capabilities ?? []) {
        previousStateByCapability.set(capability.capability_id, capability);
    }
    const newEvents = [];
    for (const capability of options.current.capabilities) {
        const previousState = previousStateByCapability.get(capability.capability_id)
            ?? previousCapabilityStateFromEvents(previousEvents, capability.capability_id);
        const event = lifecycleHistoryEvent(capability, previousState, {
            recordedAt,
            reportGeneratedAt: options.current.generated_at,
            sequence: previousEvents.length + newEvents.length + 1,
        });
        if (event)
            newEvents.push(event);
    }
    const events = [...previousEvents, ...newEvents];
    const changedCapabilityTrends = new Map(newEvents.map((event) => [event.capability_id, event.trend]));
    const capabilities = options.current.capabilities.map((capability) => {
        const previousState = previousStateByCapability.get(capability.capability_id)
            ?? previousCapabilityStateFromEvents(previousEvents, capability.capability_id);
        const capabilityEvents = events.filter((event) => event.capability_id === capability.capability_id);
        const firstSeenAt = previousState?.first_seen_at ?? capabilityEvents[0]?.recorded_at ?? recordedAt;
        const lastEvent = capabilityEvents[capabilityEvents.length - 1];
        const transitionPath = compactStagePath(capabilityEvents.map((event) => event.to_stage), capability.stage);
        return {
            capability_id: capability.capability_id,
            title: capability.title,
            source_cycle: capability.source_cycle,
            first_seen_at: firstSeenAt,
            last_seen_at: recordedAt,
            previous_stage: previousState?.current_stage,
            current_stage: capability.stage,
            current_decision: capability.decision,
            transition_path: transitionPath,
            event_count: capabilityEvents.length,
            last_transition: lastEvent ? formatHistoryTransition(lastEvent) : undefined,
            trend: changedCapabilityTrends.get(capability.capability_id) ?? 'unchanged',
        };
    });
    const sourceArtifacts = Array.from(new Set([
        PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH,
        ...(previous ? [PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH] : []),
        ...options.current.source_artifacts,
    ])).sort();
    return {
        schema_version: 1,
        updated_at: recordedAt,
        root,
        current_report_generated_at: options.current.generated_at,
        source_artifacts: sourceArtifacts,
        aggregates: {
            capability_count: capabilities.length,
            event_count: events.length,
            transition_count: events.filter((event) => event.event_type === 'stage-transition').length,
            progressed_capabilities: capabilities.filter((capability) => capability.trend === 'progressed').length,
            regressed_capabilities: capabilities.filter((capability) => capability.trend === 'regressed').length,
            triaged_capabilities: capabilities.filter((capability) => capability.trend === 'triaged').length,
            new_capabilities: capabilities.filter((capability) => capability.trend === 'new').length,
            seeded_current: capabilities.filter((capability) => capability.current_stage === 'seeded').length,
            proving_current: capabilities.filter((capability) => capability.current_stage === 'proving').length,
            connected_current: capabilities.filter((capability) => capability.current_stage === 'connected').length,
            mature_current: capabilities.filter((capability) => capability.current_stage === 'mature').length,
            remove_candidates_current: capabilities.filter((capability) => capability.current_stage === 'remove-candidate').length,
            v0_pressure_current: capabilities.filter((capability) => capability.current_stage === 'seeded' || capability.current_stage === 'proving').length,
        },
        capabilities,
        events,
        next_action: historyNextAction(capabilities),
    };
}
export function writeProductCapabilityLifecycleHistory(root = process.cwd(), history) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, history);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductCapabilityLifecycleHistory(history), 'utf-8');
    return { jsonPath, mdPath };
}
export function renderProductCapabilityLifecycleAudit(report) {
    const rows = report.capabilities.map((capability) => (`| ${escapeCell(capability.capability_id)} | ${capability.stage} | ${capability.decision} | ${escapeCell(capability.title)} | ${capability.scenario_coverage} | ${capability.missing_depth_count} | ${capability.regression_debt_count} |`));
    const actionRows = report.capabilities
        .filter((capability) => capability.stage !== 'mature')
        .map((capability) => (`| ${capability.stage} | ${escapeCell(capability.title)} | ${escapeCell(capability.recommended_action)} |`));
    return [
        '# Product Capability Lifecycle',
        '',
        `status: ${report.status}`,
        `generated_at: ${report.generated_at}`,
        `schema_source: ${PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH}`,
        '',
        '## Aggregates',
        `- capability_count: ${report.aggregates.capability_count}`,
        `- seeded: ${report.aggregates.seeded}`,
        `- proving: ${report.aggregates.proving}`,
        `- connected: ${report.aggregates.connected}`,
        `- mature: ${report.aggregates.mature}`,
        `- deprecated: ${report.aggregates.deprecated}`,
        `- remove_candidates: ${report.aggregates.remove_candidates}`,
        `- error_debt_capabilities: ${report.aggregates.error_debt_capabilities}`,
        '',
        '## Lifecycle',
        '| Capability | Stage | Decision | Title | Scenario | Missing Depth | Debts |',
        '| --- | --- | --- | --- | --- | ---: | ---: |',
        ...(rows.length > 0 ? rows : ['| none | seeded | develop-depth | No completed capabilities yet | none | 0 | 0 |']),
        '',
        '## Actions',
        '| Stage | Capability | Recommended Action |',
        '| --- | --- | --- |',
        ...(actionRows.length > 0 ? actionRows : ['| mature | product | No lifecycle actions required |']),
        '',
        '## Source Artifacts',
        ...report.source_artifacts.map((source) => `- ${source}`),
        '',
        `next_action: ${report.next_action}`,
        '',
    ].join('\n');
}
export function renderProductCapabilityLifecycleHistory(report) {
    const capabilityRows = report.capabilities.map((capability) => (`| ${escapeCell(capability.capability_id)} | ${capability.previous_stage ?? 'new'} | ${capability.current_stage} | ${capability.trend} | ${escapeCell(capability.transition_path.join(' -> '))} |`));
    const eventRows = report.events.slice(-20).map((event) => (`| ${event.recorded_at} | ${event.capability_id} | ${event.from_stage ?? 'new'} -> ${event.to_stage} | ${event.trend} | ${escapeCell(event.reason)} |`));
    return [
        '# Product Capability Lifecycle History',
        '',
        `updated_at: ${report.updated_at}`,
        `schema_source: ${PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH}`,
        `current_report_generated_at: ${report.current_report_generated_at}`,
        '',
        '## Aggregates',
        `- capability_count: ${report.aggregates.capability_count}`,
        `- event_count: ${report.aggregates.event_count}`,
        `- transition_count: ${report.aggregates.transition_count}`,
        `- progressed_capabilities: ${report.aggregates.progressed_capabilities}`,
        `- regressed_capabilities: ${report.aggregates.regressed_capabilities}`,
        `- triaged_capabilities: ${report.aggregates.triaged_capabilities}`,
        `- new_capabilities: ${report.aggregates.new_capabilities}`,
        `- seeded_current: ${report.aggregates.seeded_current}`,
        `- proving_current: ${report.aggregates.proving_current}`,
        `- connected_current: ${report.aggregates.connected_current}`,
        `- mature_current: ${report.aggregates.mature_current}`,
        `- remove_candidates_current: ${report.aggregates.remove_candidates_current}`,
        `- v0_pressure_current: ${report.aggregates.v0_pressure_current}`,
        '',
        '## Current Paths',
        '| Capability | Previous | Current | Trend | Path |',
        '| --- | --- | --- | --- | --- |',
        ...(capabilityRows.length > 0 ? capabilityRows : ['| none | new | seeded | unchanged | No lifecycle observations yet |']),
        '',
        '## Recent Events',
        '| Recorded At | Capability | Transition | Trend | Reason |',
        '| --- | --- | --- | --- | --- |',
        ...(eventRows.length > 0 ? eventRows : ['| none | product | new -> seeded | unchanged | No lifecycle events recorded |']),
        '',
        '## Source Artifacts',
        ...report.source_artifacts.map((source) => `- ${source}`),
        '',
        `next_action: ${report.next_action}`,
        '',
    ].join('\n');
}
function lifecycleItem(capability, totality, scenarioCoverage, regression, lifecycleContext) {
    const scenario = scenarioCoverage.scenarios.find((entry) => entry.capability_id === capability.id);
    const debts = regression.debts.filter((debt) => debtAppliesToCapability(debt, capability));
    const orphan = totality.capability_graph.orphan_capabilities.some((entry) => entry.capability_id === capability.id);
    const deprecated = lifecycleContextMentions(lifecycleContext.text, capability, ['deprecated', 'deprecate', 'sunset']);
    const removeMarked = lifecycleContextMentions(lifecycleContext.text, capability, [
        'remove-candidate',
        'remove candidate',
        'remove-or-redesign',
        'remove/merge/redesign',
        'rewrite',
    ]);
    const stage = determineCapabilityStage({
        capability,
        scenario,
        debts,
        orphan,
        deprecated,
        removeMarked,
    });
    const reasons = lifecycleReasons({ capability, scenario, debts, orphan, deprecated, removeMarked });
    const decision = decisionForStage(stage);
    const action = recommendedActionForStage(stage, capability, scenario);
    return {
        capability_id: capability.id,
        title: capability.title,
        source_cycle: capability.source_cycle,
        stage,
        decision,
        maturity: capability.maturity,
        scenario_coverage: scenario?.coverage ?? 'none',
        connection_count: capability.connections.length,
        missing_depth_count: capability.missing_depth.length,
        regression_debt_count: debts.length,
        error_debt_count: debts.filter((debt) => debt.severity === 'error').length,
        orphan,
        reasons,
        recommended_action: action,
        evidence: Array.from(new Set([
            capability.source_path,
            ...capability.evidence,
            ...(scenario?.evidence ?? []),
            ...debts.flatMap((debt) => debt.evidence),
        ])).filter(Boolean),
    };
}
function determineCapabilityStage(input) {
    const errorDebt = input.debts.some((debt) => debt.severity === 'error');
    const scenarioCoverage = input.scenario?.coverage;
    const scenarioPassed = scenarioCoverage === 'runtime-passed';
    const weakOrIsolated = input.orphan || input.capability.connections.length === 0;
    const depthMissing = input.capability.missing_depth.length > 0;
    if (input.deprecated)
        return 'deprecated';
    if (input.removeMarked)
        return 'remove-candidate';
    if (weakOrIsolated
        && !scenarioPassed
        && (errorDebt || input.capability.maturity === 'missing-expectation' || depthMissing)) {
        return 'remove-candidate';
    }
    if (input.capability.maturity === 'systemic-v2' && scenarioPassed && !errorDebt && !input.orphan)
        return 'mature';
    if (!scenarioPassed && input.capability.maturity !== 'missing-expectation')
        return 'proving';
    if (input.capability.connections.length >= 2 && !errorDebt)
        return 'connected';
    return 'seeded';
}
function lifecycleReasons(input) {
    const reasons = [];
    if (input.deprecated)
        reasons.push('roadmap or portfolio marks this capability deprecated');
    if (input.removeMarked)
        reasons.push('roadmap or portfolio marks this capability for removal/rewrite');
    if (input.orphan)
        reasons.push('capability graph marks this as orphaned');
    if (!input.scenario)
        reasons.push('no scenario coverage entry');
    else if (input.scenario.coverage !== 'runtime-passed')
        reasons.push(`scenario coverage is ${input.scenario.coverage}`);
    if (input.capability.maturity === 'missing-expectation')
        reasons.push('missing feature expectation contract');
    if (input.capability.missing_depth.length > 0)
        reasons.push(`${input.capability.missing_depth.length} maturity/depth item(s) missing`);
    if (input.capability.connections.length === 0)
        reasons.push('no product/context/learning connections');
    if (input.debts.length > 0)
        reasons.push(`${input.debts.length} regression debt item(s) apply`);
    if (reasons.length === 0)
        reasons.push('capability has current lifecycle evidence');
    return reasons;
}
function decisionForStage(stage) {
    if (stage === 'mature')
        return 'retain';
    if (stage === 'connected')
        return 'connect';
    if (stage === 'proving')
        return 'prove';
    if (stage === 'deprecated')
        return 'deprecate';
    if (stage === 'remove-candidate')
        return 'remove-or-redesign';
    return 'develop-depth';
}
function recommendedActionForStage(stage, capability, scenario) {
    if (stage === 'mature')
        return 'Treat as stable product foundation; avoid re-selecting unless a new learning signal appears.';
    if (stage === 'deprecated')
        return 'Keep out of selected cycle unless explicitly reviving with a new expectation contract.';
    if (stage === 'remove-candidate')
        return 'Remove, merge, or redesign this capability around a real user loop before adding more surface area.';
    if (stage === 'proving')
        return scenario
            ? scenario.recommended_action
            : `Generate and run a scenario for ${capability.title} before treating it as complete.`;
    if (stage === 'connected')
        return 'Keep connected in roadmap, then add the smallest missing v1/v2 maturity depth.';
    return 'Treat as a seeded capability: add v1/v2 depth and scenario proof before calling it done.';
}
function determineStatus(items) {
    if (items.length === 0)
        return 'empty';
    if (items.some((item) => item.stage === 'remove-candidate' || item.stage === 'deprecated'))
        return 'needs-triage';
    if (items.some((item) => item.stage === 'proving'))
        return 'needs-proof';
    if (items.some((item) => item.stage === 'seeded' || item.orphan))
        return 'needs-connection';
    return 'healthy';
}
function nextAction(status) {
    if (status === 'empty')
        return 'Complete a product-cycle, then run omc capability-lifecycle audit --write';
    if (status === 'needs-triage')
        return 'Resolve remove/deprecate candidates before selecting unrelated new work';
    if (status === 'needs-proof')
        return 'Run scenario proof or dogfood evidence for proving capabilities';
    if (status === 'needs-connection')
        return 'Feed seeded and orphaned capabilities into priority-engine as depth/connection work';
    return 'Capability lifecycle is healthy; prioritize new work against mature foundations';
}
function previousCapabilityStateFromEvents(events, capabilityId) {
    const capabilityEvents = events.filter((event) => event.capability_id === capabilityId);
    const last = capabilityEvents[capabilityEvents.length - 1];
    if (!last)
        return undefined;
    return {
        capability_id: last.capability_id,
        title: last.title,
        source_cycle: last.source_cycle,
        first_seen_at: capabilityEvents[0]?.recorded_at ?? last.recorded_at,
        last_seen_at: last.recorded_at,
        previous_stage: last.from_stage,
        current_stage: last.to_stage,
        current_decision: last.to_decision,
        transition_path: compactStagePath(capabilityEvents.map((event) => event.to_stage), last.to_stage),
        event_count: capabilityEvents.length,
        last_transition: formatHistoryTransition(last),
        trend: last.trend,
    };
}
function lifecycleHistoryEvent(capability, previous, context) {
    const fromStage = previous?.current_stage;
    const fromDecision = previous?.current_decision;
    const stageChanged = Boolean(fromStage && fromStage !== capability.stage);
    const decisionChanged = Boolean(previous && !stageChanged && fromDecision !== capability.decision);
    if (previous && !stageChanged && !decisionChanged)
        return undefined;
    const eventType = !previous
        ? 'observed'
        : stageChanged
            ? 'stage-transition'
            : 'decision-change';
    const trend = !previous
        ? 'new'
        : stageChanged
            ? classifyLifecycleTransition(fromStage, capability.stage)
            : 'decision-change';
    const reason = !previous
        ? `First lifecycle observation: ${capability.stage}.`
        : stageChanged
            ? `Lifecycle moved from ${fromStage} to ${capability.stage}.`
            : `Lifecycle decision changed from ${fromDecision} to ${capability.decision}.`;
    return {
        event_id: `${context.sequence}-${capability.capability_id}-${fromStage ?? 'new'}-${capability.stage}`,
        event_type: eventType,
        recorded_at: context.recordedAt,
        report_generated_at: context.reportGeneratedAt,
        capability_id: capability.capability_id,
        title: capability.title,
        source_cycle: capability.source_cycle,
        from_stage: fromStage,
        to_stage: capability.stage,
        from_decision: fromDecision,
        to_decision: capability.decision,
        trend,
        reason,
        evidence: capability.evidence,
    };
}
function classifyLifecycleTransition(from, to) {
    if (!from)
        return 'new';
    if (to === 'remove-candidate')
        return 'triaged';
    const fromRank = lifecycleStageRank(from);
    const toRank = lifecycleStageRank(to);
    if (toRank > fromRank)
        return 'progressed';
    if (toRank < fromRank)
        return 'regressed';
    return 'unchanged';
}
function lifecycleStageRank(stage) {
    if (stage === 'remove-candidate')
        return -1;
    if (stage === 'deprecated')
        return 0;
    if (stage === 'seeded')
        return 0;
    if (stage === 'proving')
        return 1;
    if (stage === 'connected')
        return 2;
    return 3;
}
function compactStagePath(stages, currentStage) {
    const compact = [];
    for (const stage of stages) {
        if (compact[compact.length - 1] !== stage)
            compact.push(stage);
    }
    if (compact[compact.length - 1] !== currentStage)
        compact.push(currentStage);
    return compact;
}
function formatHistoryTransition(event) {
    return `${event.from_stage ?? 'new'} -> ${event.to_stage}`;
}
function historyNextAction(capabilities) {
    if (capabilities.length === 0)
        return 'Complete a product-cycle, then write lifecycle history.';
    if (capabilities.some((capability) => capability.current_stage === 'remove-candidate')) {
        return 'Resolve remove-candidate lifecycle paths before adding unrelated new capabilities.';
    }
    if (capabilities.some((capability) => capability.trend === 'regressed')) {
        return 'Inspect regressed lifecycle paths and recover proof, connection, or depth.';
    }
    const v0Pressure = capabilities.filter((capability) => (capability.current_stage === 'seeded' || capability.current_stage === 'proving')).length;
    const durableMass = capabilities.filter((capability) => (capability.current_stage === 'connected' || capability.current_stage === 'mature')).length;
    if (v0Pressure > durableMass) {
        return 'Prioritize proof, connection, and depth until seeded/proving mass stops outgrowing connected/mature mass.';
    }
    return 'Lifecycle mass is improving; rank new work against connected and mature foundations.';
}
function debtAppliesToCapability(debt, capability) {
    if (debt.source_cycle && debt.source_cycle === capability.source_cycle)
        return true;
    const haystack = normalize(`${debt.id} ${debt.subject} ${debt.message} ${debt.recommended_action}`);
    return lifecycleKeywords(`${capability.id} ${capability.title} ${capability.user_job ?? ''} ${capability.first_meaningful_use ?? ''}`)
        .some((token) => haystack.includes(token));
}
function readLifecycleContext(root) {
    const candidates = [
        '.omc/portfolio/current.json',
        '.omc/roadmap/current.md',
        '.omc/opportunities/current.md',
    ];
    const present = [];
    const text = candidates.flatMap((relativePath) => {
        const path = resolve(root, relativePath);
        if (!existsSync(path))
            return [];
        present.push(relativePath);
        try {
            return [readFileSync(path, 'utf-8')];
        }
        catch {
            return [];
        }
    }).join('\n');
    return { text, sources: present };
}
function lifecycleContextMentions(text, capability, markers) {
    const normalizedMarkers = markers.map(normalize);
    if (!normalizedMarkers.some((marker) => normalize(text).includes(marker)))
        return false;
    const tokens = lifecycleKeywords(`${capability.id} ${capability.title}`);
    const phrases = Array.from(new Set([capability.id, capability.title]
        .map(normalize)
        .filter((phrase) => phrase.length > 3)));
    return localLifecycleWindows(text).some((window) => (normalizedMarkers.some((marker) => window.includes(marker))
        && (phrases.some((phrase) => window.includes(phrase)) || tokens.some((token) => window.includes(token)))));
}
function localLifecycleWindows(text) {
    const lines = text.split(/\r?\n/);
    const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.length <= 1000);
    return [...lines, ...paragraphs].map(normalize).filter((window) => window.length > 0);
}
function lifecycleKeywords(value) {
    return Array.from(new Set(normalize(value)
        .split(/\s+/)
        .filter((token) => token.length > 3 && !LIFECYCLE_STOP_WORDS.has(token))))
        .slice(0, 12);
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const LIFECYCLE_STOP_WORDS = new Set([
    'with',
    'from',
    'that',
    'this',
    'into',
    'user',
    'users',
    'cycle',
    'feature',
    'capability',
    'product',
    'first',
    'loop',
    'able',
    'without',
    'current',
    'state',
    'next',
]);
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=capability-lifecycle.js.map
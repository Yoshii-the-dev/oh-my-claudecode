import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import { RUNTIME_QA_CONFIG_RELATIVE_PATH, RUNTIME_QA_HANDOFF_RELATIVE_PATH, readRuntimeQaConfig, } from '../runtime-qa/runner.js';
import { PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH, } from './capability-graph.js';
import { PRODUCT_TOTALITY_JSON_RELATIVE_PATH, generateProductTotalityAudit, } from './product-totality.js';
import { PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH, readProductScenarioPlan, } from './scenario-generator.js';
export const PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH = '.omc/product/scenario-coverage/current.json';
export const PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH = '.omc/product/scenario-coverage/current.md';
const SCENARIO_STOP_WORDS = new Set([
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
    'expected',
    'should',
]);
export function generateProductScenarioCoverageAudit(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const totality = options.totality ?? generateProductTotalityAudit(root);
    const scenarioPlan = readProductScenarioPlan(root);
    const runtimeConfig = readRuntimeQaConfig(root);
    const runtimeHandoff = readRuntimeQaHandoff(root);
    const scenarios = totality.capabilities.map((capability) => buildScenario(capability, scenarioPlan, runtimeConfig, runtimeHandoff));
    const gaps = buildScenarioGaps(scenarios, totality);
    const status = determineStatus(totality.capabilities.length, scenarios, gaps);
    const sourceArtifacts = Array.from(new Set([
        PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
        PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH,
        ...(scenarioPlan ? [PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH] : []),
        ...totality.source_artifacts,
        ...(runtimeConfig ? [RUNTIME_QA_CONFIG_RELATIVE_PATH] : []),
        ...(runtimeHandoff ? [RUNTIME_QA_HANDOFF_RELATIVE_PATH] : []),
    ])).sort();
    return {
        schema_version: 1,
        generated_at: (options.now ?? new Date()).toISOString(),
        root,
        status,
        source_artifacts: sourceArtifacts,
        aggregates: {
            capability_count: totality.capabilities.length,
            scenario_count: scenarios.length,
            covered_scenarios: scenarios.filter((scenario) => scenario.coverage === 'runtime-passed').length,
            declared_scenarios: scenarios.filter((scenario) => scenario.coverage === 'declared').length,
            missing_scenarios: scenarios.filter((scenario) => scenario.coverage === 'missing').length,
            failing_scenarios: scenarios.filter((scenario) => scenario.coverage === 'runtime-failed').length,
            stale_scenarios: scenarios.filter((scenario) => scenario.coverage === 'stale' || scenario.coverage === 'dry-run').length,
            runtime_qa_configured: Boolean(runtimeConfig),
            runtime_qa_handoff_exists: Boolean(runtimeHandoff),
        },
        scenarios,
        gaps,
        next_action: nextAction(status, gaps),
    };
}
export function writeProductScenarioCoverageAudit(root = process.cwd(), report = generateProductScenarioCoverageAudit({ root })) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, report);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductScenarioCoverageAudit(report), 'utf-8');
    return { jsonPath, mdPath };
}
export function renderProductScenarioCoverageAudit(report) {
    const scenarioRows = report.scenarios.map((scenario) => (`| ${escapeCell(scenario.id)} | ${scenario.coverage} | ${escapeCell(scenario.capability_title)} | ${escapeCell(scenario.expected_user_loop)} | ${scenario.gaps.length} |`));
    const gapRows = report.gaps.map((gap) => (`| ${gap.severity} | ${gap.code} | ${escapeCell(gap.subject)} | ${escapeCell(gap.recommended_action)} |`));
    return [
        '# Product Scenario Coverage',
        '',
        `status: ${report.status}`,
        `generated_at: ${report.generated_at}`,
        `schema_source: ${PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH}`,
        '',
        '## Aggregates',
        `- capability_count: ${report.aggregates.capability_count}`,
        `- scenario_count: ${report.aggregates.scenario_count}`,
        `- covered_scenarios: ${report.aggregates.covered_scenarios}`,
        `- declared_scenarios: ${report.aggregates.declared_scenarios}`,
        `- missing_scenarios: ${report.aggregates.missing_scenarios}`,
        `- failing_scenarios: ${report.aggregates.failing_scenarios}`,
        `- stale_scenarios: ${report.aggregates.stale_scenarios}`,
        `- runtime_qa_configured: ${report.aggregates.runtime_qa_configured}`,
        `- runtime_qa_handoff_exists: ${report.aggregates.runtime_qa_handoff_exists}`,
        '',
        '## Scenarios',
        '| Scenario | Coverage | Capability | Expected User Loop | Gaps |',
        '| --- | --- | --- | --- | ---: |',
        ...(scenarioRows.length > 0 ? scenarioRows : ['| none | missing | No completed capability scenarios yet | none | 0 |']),
        '',
        '## Gaps',
        '| Severity | Code | Subject | Recommended Action |',
        '| --- | --- | --- | --- |',
        ...(gapRows.length > 0 ? gapRows : ['| warning | none | product | No scenario coverage gaps detected |']),
        '',
        '## Source Artifacts',
        ...report.source_artifacts.map((source) => `- ${source}`),
        '',
        `next_action: ${report.next_action}`,
        '',
    ].join('\n');
}
function buildScenario(capability, scenarioPlan, runtimeConfig, runtimeHandoff) {
    const expectedUserLoop = capability.first_meaningful_use
        ?? capability.user_job
        ?? capability.implemented_as
        ?? capability.title;
    const scenarioText = [
        capability.id,
        capability.title,
        capability.user_job ?? '',
        capability.first_meaningful_use ?? '',
        capability.implemented_as,
        expectedUserLoop,
    ].join(' ');
    const generatedMatch = generatedScenarioMatches(scenarioPlan, capability, scenarioText);
    const declared = runtimeConfigMatches(runtimeConfig, scenarioText) || generatedMatch;
    const handoffMatch = runtimeHandoffMatches(runtimeHandoff, capability, scenarioText);
    const coverage = inferCoverage(capability, declared, handoffMatch, runtimeHandoff);
    const gaps = scenarioGaps(capability, coverage, declared, runtimeHandoff);
    return {
        id: `${capability.id}-scenario`,
        capability_id: capability.id,
        capability_title: capability.title,
        expected_user_loop: expectedUserLoop,
        source_cycle: capability.source_cycle,
        coverage,
        runtime_qa_status: runtimeHandoff?.status,
        evidence: Array.from(new Set([
            capability.source_path,
            ...capability.evidence,
            ...(generatedMatch ? [PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH] : []),
            ...(runtimeConfig ? [RUNTIME_QA_CONFIG_RELATIVE_PATH] : []),
            ...(handoffMatch ? [RUNTIME_QA_HANDOFF_RELATIVE_PATH] : []),
        ])).filter(Boolean),
        gaps,
        recommended_action: recommendedAction(capability, coverage),
    };
}
function inferCoverage(capability, declared, handoffMatch, runtimeHandoff) {
    if (!declared && !runtimeHandoff)
        return 'missing';
    if (!runtimeHandoff)
        return declared ? 'declared' : 'missing';
    if (!handoffMatch && runtimeHandoff.status === 'passed')
        return declared ? 'stale' : 'missing';
    if (runtimeHandoff.status === 'dry-run')
        return handoffMatch || declared ? 'dry-run' : 'missing';
    if (!handoffMatch && runtimeHandoff.cycle_id && runtimeHandoff.cycle_id !== capability.source_cycle) {
        return declared ? 'stale' : 'missing';
    }
    if (runtimeHandoff.status === 'passed')
        return handoffMatch || declared ? 'runtime-passed' : 'missing';
    if (runtimeHandoff.status === 'failed' || runtimeHandoff.status === 'blocked') {
        return handoffMatch || declared ? 'runtime-failed' : 'missing';
    }
    if (runtimeHandoff.status === 'partial-pass')
        return handoffMatch || declared ? 'runtime-failed' : 'missing';
    return declared ? 'declared' : 'missing';
}
function scenarioGaps(capability, coverage, declared, runtimeHandoff) {
    const gaps = [];
    if (!capability.first_meaningful_use && !capability.user_job) {
        gaps.push('missing explicit user loop');
    }
    if (!declared) {
        gaps.push('no scenario declaration in runtime QA flow or command');
    }
    if (!runtimeHandoff) {
        gaps.push('no executed runtime QA handoff');
    }
    if (coverage === 'runtime-failed')
        gaps.push('runtime scenario is failing or blocked');
    if (coverage === 'dry-run')
        gaps.push('runtime scenario has only dry-run evidence');
    if (coverage === 'stale')
        gaps.push('runtime scenario evidence is stale for this capability cycle');
    if (coverage === 'missing')
        gaps.push('no executable scenario evidence');
    return Array.from(new Set(gaps));
}
function buildScenarioGaps(scenarios, totality) {
    const gaps = [];
    if (totality.capabilities.length === 0) {
        gaps.push({
            severity: 'warning',
            code: 'no-capability-scenarios',
            subject: 'product',
            message: 'No completed capabilities exist yet, so no user scenarios can be mapped.',
            recommended_action: 'Complete a product-cycle, then run omc scenario-coverage audit --write.',
        });
    }
    for (const scenario of scenarios) {
        if (scenario.coverage === 'missing') {
            gaps.push({
                severity: 'error',
                code: 'missing-scenario-coverage',
                subject: scenario.capability_title,
                message: 'Capability has no executable or declared scenario evidence.',
                recommended_action: scenario.recommended_action,
            });
        }
        else if (scenario.coverage === 'declared') {
            gaps.push({
                severity: 'warning',
                code: 'scenario-declared-not-run',
                subject: scenario.capability_title,
                message: 'Capability has a scenario declaration, but no executed runtime QA handoff proves it.',
                recommended_action: scenario.recommended_action,
            });
        }
        else if (scenario.coverage === 'runtime-failed') {
            gaps.push({
                severity: 'error',
                code: 'scenario-runtime-failing',
                subject: scenario.capability_title,
                message: 'Runtime QA evidence exists but is failing, blocked, or partial.',
                recommended_action: 'Fix the scenario runtime failure before learning/completion can claim this capability.',
            });
        }
        else if (scenario.coverage === 'dry-run' || scenario.coverage === 'stale') {
            gaps.push({
                severity: 'warning',
                code: 'scenario-evidence-not-current',
                subject: scenario.capability_title,
                message: 'Scenario evidence is dry-run or stale for the capability cycle.',
                recommended_action: scenario.recommended_action,
            });
        }
    }
    for (const orphan of totality.capability_graph.orphan_capabilities) {
        const scenario = scenarios.find((entry) => entry.capability_id === orphan.capability_id);
        if (scenario?.coverage !== 'runtime-passed') {
            gaps.push({
                severity: orphan.severity,
                code: 'orphan-without-scenario-proof',
                subject: orphan.title,
                message: 'Capability graph flags this as orphaned and scenario coverage does not prove a real user loop.',
                recommended_action: 'Create a scenario that connects the orphan capability to a return-session/product-system flow, then run runtime QA.',
            });
        }
    }
    return dedupeGaps(gaps);
}
function determineStatus(capabilityCount, scenarios, gaps) {
    if (capabilityCount === 0)
        return 'empty';
    if (scenarios.some((scenario) => scenario.coverage === 'runtime-failed'))
        return 'runtime-failing';
    if (gaps.some((gap) => gap.code === 'missing-scenario-coverage'))
        return 'missing-scenarios';
    if (scenarios.some((scenario) => scenario.coverage !== 'runtime-passed'))
        return 'needs-runtime-evidence';
    return 'covered';
}
function nextAction(status, gaps) {
    if (status === 'empty')
        return 'Complete a product-cycle, then run omc scenario-coverage audit --write';
    if (status === 'runtime-failing')
        return 'Fix failing runtime QA scenarios before learning/completion claims scenario coverage';
    if (status === 'missing-scenarios')
        return 'Add runtime QA flow/verifies entries for missing capability scenarios, then run omc runtime-qa run --auto --json';
    if (gaps.length > 0)
        return 'Run executable runtime QA for declared/stale scenarios, then rerun omc scenario-coverage audit --write';
    return 'Scenario coverage is current; feed it into product-totality and priority-engine as evidence';
}
function recommendedAction(capability, coverage) {
    if (coverage === 'runtime-failed')
        return `Fix the failing runtime scenario for ${capability.title}.`;
    if (coverage === 'declared' || coverage === 'dry-run' || coverage === 'stale') {
        return `Run executable runtime QA for ${capability.title} and refresh .omc/handoffs/runtime-qa/current.json.`;
    }
    return `Declare and run a runtime QA or dogfood scenario for ${capability.title} that proves: ${capability.first_meaningful_use ?? capability.user_job ?? capability.title}.`;
}
function runtimeConfigMatches(config, scenarioText) {
    if (!config)
        return false;
    const haystack = JSON.stringify({
        commands: config.commands,
        mobile: config.mobile,
        flows: config.flows,
        gates: config.gates,
    });
    return fuzzyMentions(haystack, scenarioText)
        || (config.flows ?? []).some((flow) => fuzzyMentions(`${flow.id ?? ''} ${flow.path} ${flow.spec ?? ''} ${(flow.verifies ?? []).join(' ')}`, scenarioText));
}
function generatedScenarioMatches(report, capability, scenarioText) {
    if (!report)
        return false;
    return report.scenarios.some((scenario) => {
        if (scenario.cycle_id === capability.source_cycle)
            return true;
        const generatedText = [
            scenario.id,
            scenario.capability_title,
            scenario.user_job,
            scenario.first_meaningful_use,
            scenario.loop.setup,
            scenario.loop.start,
            scenario.loop.core_action,
            scenario.loop.return,
            scenario.loop.continue_with_context,
            scenario.runtime_qa_flow.spec,
            scenario.runtime_qa_flow.verifies.join(' '),
        ].join(' ');
        return fuzzyMentions(generatedText, scenarioText);
    });
}
function runtimeHandoffMatches(report, capability, scenarioText) {
    if (!report)
        return false;
    if (report.cycle_id && report.cycle_id === capability.source_cycle)
        return true;
    const steps = report.step_results.map((step) => `${step.name} ${step.command ?? ''} ${step.reason}`).join('\n');
    return fuzzyMentions(steps, scenarioText);
}
function fuzzyMentions(haystack, needle) {
    const tokens = keywords(needle);
    if (tokens.length === 0)
        return false;
    const normalizedHaystack = normalize(haystack);
    const hits = tokens.filter((token) => normalizedHaystack.includes(token));
    return hits.length >= Math.min(2, tokens.length);
}
function keywords(value) {
    return Array.from(new Set(value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 3 && !SCENARIO_STOP_WORDS.has(token))))
        .slice(0, 12);
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}
function readRuntimeQaHandoff(root) {
    const path = resolve(root, RUNTIME_QA_HANDOFF_RELATIVE_PATH);
    if (!existsSync(path))
        return undefined;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return parsed?.schema_version === 1 && parsed.agent_role === 'runtime-qa-runner' ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function dedupeGaps(gaps) {
    const seen = new Set();
    const out = [];
    for (const gap of gaps) {
        const key = `${gap.code}:${gap.subject}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(gap);
    }
    return out;
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=scenario-coverage.js.map
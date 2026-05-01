import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import { RUNTIME_QA_CONFIG_RELATIVE_PATH, detectRuntimeQaConfig, readRuntimeQaConfig, } from '../runtime-qa/runner.js';
import { CYCLE_DOCUMENT_RELATIVE_PATH, CYCLE_PROJECTION_RELATIVE_PATH, parseCycleMarkdown, readCycleDocument, } from './cycle-document.js';
export const PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH = '.omc/product/scenarios/current.json';
export const PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH = '.omc/product/scenarios/current.md';
const PLACEHOLDER_PATTERN = /\b(?:tbd|todo|placeholder|pending|n\/a|none)\b/i;
export function generateProductScenarioPlan(root = process.cwd(), now = new Date()) {
    const resolvedRoot = resolve(root);
    const sources = collectCycleScenarioSources(resolvedRoot);
    const scenarios = sources
        .filter((source) => hasUsableExpectation(source.document.spec.feature_expectation_contract))
        .map((source) => buildScenario(source));
    const gaps = buildGaps(sources, scenarios);
    const status = determineStatus(sources.length, scenarios.length, gaps);
    return {
        schema_version: 1,
        generated_at: now.toISOString(),
        root: resolvedRoot,
        status,
        source_artifacts: Array.from(new Set(sources.map((source) => source.sourceRelativePath))).sort(),
        aggregates: {
            cycle_count: sources.length,
            scenario_count: scenarios.length,
            missing_expectation_count: gaps.filter((gap) => gap.code === 'missing-feature-expectation').length,
            return_session_scenarios: scenarios.filter((scenario) => scenario.steps.some((step) => step.phase === 'return')).length,
        },
        scenarios,
        gaps,
        next_action: nextAction(status),
    };
}
export function writeProductScenarioPlan(root = process.cwd(), report = generateProductScenarioPlan(root)) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, report);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductScenarioPlan(report), 'utf-8');
    return { jsonPath, mdPath };
}
export function readProductScenarioPlan(root = process.cwd()) {
    const path = resolve(root, PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH);
    if (!existsSync(path))
        return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
export function applyGeneratedScenariosToRuntimeQa(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const report = options.report ?? generateProductScenarioPlan(root, options.now);
    const existing = readRuntimeQaConfig(root);
    const detected = detectRuntimeQaConfig(root, existing?.target);
    const config = mergeRuntimeQaConfig(existing, detected);
    const runtimeSupported = hasExecutableRuntimeHarness(config);
    const generatedFlows = report.scenarios.map((scenario) => scenario.runtime_qa_flow);
    const currentFlows = config.flows ?? [];
    const existingFlowKeys = new Set(currentFlows.map(flowKey));
    const flowsToAdd = generatedFlows.filter((flow) => !existingFlowKeys.has(flowKey(flow)));
    const mergedConfig = {
        ...config,
        schema_version: 1,
        flows: [...currentFlows, ...flowsToAdd],
    };
    const status = generatedFlows.length === 0
        ? 'no-scenarios'
        : !runtimeSupported
            ? 'needs-harness'
            : flowsToAdd.length === 0
                ? 'current'
                : 'applied';
    const written = options.write === true && runtimeSupported && generatedFlows.length > 0 && (flowsToAdd.length > 0 || !existing);
    if (written) {
        const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
        mkdirSync(dirname(path), { recursive: true });
        atomicWriteJsonSync(path, mergedConfig);
    }
    return {
        schema_version: 1,
        generated_at: (options.now ?? new Date()).toISOString(),
        root,
        status,
        config_path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        runtime_supported: runtimeSupported,
        scenario_count: report.scenarios.length,
        flow_count: mergedConfig.flows?.length ?? 0,
        added_flows: flowsToAdd.map((flow) => flow.id ?? flow.path),
        existing_flows: currentFlows.map((flow) => flow.id ?? flow.path),
        written,
        next_action: scenarioRuntimeQaNextAction(status),
        config: runtimeSupported && generatedFlows.length > 0 ? mergedConfig : undefined,
    };
}
export function renderProductScenarioPlan(report) {
    const rows = report.scenarios.map((scenario) => (`| ${escapeCell(scenario.id)} | ${escapeCell(scenario.capability_title)} | ${escapeCell(scenario.first_meaningful_use)} | ${scenario.steps.length} |`));
    const gapRows = report.gaps.map((gap) => (`| ${gap.severity} | ${gap.code} | ${escapeCell(gap.subject)} | ${escapeCell(gap.recommended_action)} |`));
    const scenarioSections = report.scenarios.flatMap((scenario) => [
        `### ${scenario.capability_title}`,
        '',
        `scenario_id: ${scenario.id}`,
        `cycle_id: ${scenario.cycle_id}`,
        `runtime_qa_flow: ${scenario.runtime_qa_flow.id}`,
        '',
        '| Step | Phase | Action | Expected State |',
        '| ---: | --- | --- | --- |',
        ...scenario.steps.map((step) => `| ${step.order} | ${step.phase} | ${escapeCell(step.action)} | ${escapeCell(step.expected_state)} |`),
        '',
        `dogfood_prompt: ${scenario.dogfood_prompt}`,
        '',
    ]);
    return [
        '# Product Scenario Generator',
        '',
        `status: ${report.status}`,
        `generated_at: ${report.generated_at}`,
        `schema_source: ${PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH}`,
        '',
        '## Aggregates',
        `- cycle_count: ${report.aggregates.cycle_count}`,
        `- scenario_count: ${report.aggregates.scenario_count}`,
        `- missing_expectation_count: ${report.aggregates.missing_expectation_count}`,
        `- return_session_scenarios: ${report.aggregates.return_session_scenarios}`,
        '',
        '## Scenarios',
        '| Scenario | Capability | First Meaningful Use | Steps |',
        '| --- | --- | --- | ---: |',
        ...(rows.length > 0 ? rows : ['| none | product | No feature expectation contracts found | 0 |']),
        '',
        '## Scenario Details',
        ...(scenarioSections.length > 0 ? scenarioSections : ['_No generated scenarios yet._', '']),
        '## Gaps',
        '| Severity | Code | Subject | Recommended Action |',
        '| --- | --- | --- | --- |',
        ...(gapRows.length > 0 ? gapRows : ['| warning | none | product | No scenario generation gaps detected |']),
        '',
        '## Source Artifacts',
        ...report.source_artifacts.map((source) => `- ${source}`),
        '',
        `next_action: ${report.next_action}`,
        '',
    ].join('\n');
}
function collectCycleScenarioSources(root) {
    const byCycle = new Map();
    for (const source of [
        readCurrentCycleSource(root),
        ...readDatedCycleJsonSources(root),
    ].filter((source) => Boolean(source))) {
        if (!byCycle.has(source.document.cycle_id) || source.sourceRelativePath === CYCLE_DOCUMENT_RELATIVE_PATH) {
            byCycle.set(source.document.cycle_id, source);
        }
    }
    return [...byCycle.values()].sort((a, b) => a.document.cycle_id.localeCompare(b.document.cycle_id));
}
function readCurrentCycleSource(root) {
    const jsonPath = resolve(root, CYCLE_DOCUMENT_RELATIVE_PATH);
    if (existsSync(jsonPath)) {
        try {
            const document = readCycleDocument(root);
            if (document) {
                return {
                    document,
                    sourcePath: jsonPath,
                    sourceRelativePath: CYCLE_DOCUMENT_RELATIVE_PATH,
                };
            }
        }
        catch {
            return undefined;
        }
    }
    const mdPath = resolve(root, CYCLE_PROJECTION_RELATIVE_PATH);
    if (!existsSync(mdPath))
        return undefined;
    try {
        return {
            document: parseCycleMarkdown(readFileSync(mdPath, 'utf-8')),
            sourcePath: mdPath,
            sourceRelativePath: CYCLE_PROJECTION_RELATIVE_PATH,
        };
    }
    catch {
        return undefined;
    }
}
function readDatedCycleJsonSources(root) {
    const cyclesDir = resolve(root, '.omc/cycles');
    if (!existsSync(cyclesDir))
        return [];
    const sources = [];
    for (const entry of readdirSync(cyclesDir)) {
        if (!entry.endsWith('.json') || entry === 'current.json')
            continue;
        const path = join(cyclesDir, entry);
        try {
            const document = JSON.parse(readFileSync(path, 'utf-8'));
            if (document?.schema_version !== 1 || typeof document.cycle_id !== 'string')
                continue;
            sources.push({
                document,
                sourcePath: path,
                sourceRelativePath: relative(root, path).replace(/\\/g, '/'),
            });
        }
        catch {
            // Ignore malformed archived cycles; cycle-document validation owns those errors.
        }
    }
    return sources;
}
function buildScenario(source) {
    const doc = source.document;
    const contract = doc.spec.feature_expectation_contract;
    const title = doc.selected_portfolio.core_product_slice || doc.cycle_goal;
    const id = `${slugify(doc.cycle_id)}-${slugify(contract.first_meaningful_use)}-scenario`;
    const runtimeFlowId = `${id}-runtime`;
    const loop = {
        setup: `Open or create the product context for: ${title}.`,
        start: contract.first_meaningful_use,
        core_action: contract.user_job,
        state_change: contract.maturity_ladder.v0,
        exit: 'Leave, close, restart, or otherwise clear transient UI state.',
        return: 'Return to the same project/session as the same user.',
        continue_with_context: contract.maturity_ladder.v1,
        proof: contract.not_done_until.join('; '),
    };
    const steps = [
        step(1, 'setup', loop.setup, 'The scenario has realistic product context, not an isolated control.'),
        step(2, 'start', loop.start, 'The user can start the first meaningful loop.'),
        step(3, 'core-action', loop.core_action, 'The core user job changes product state or context.'),
        step(4, 'state-change', loop.state_change, 'The v0 state is visible and persisted.'),
        step(5, 'exit', loop.exit, 'Transient state is no longer sufficient to pass.'),
        step(6, 'return', loop.return, 'The product restores the user to the relevant context.'),
        step(7, 'continue-with-context', loop.continue_with_context, 'The user can continue with context, not restart from scratch.'),
        step(8, 'proof', loop.proof, `The scenario fails if: ${contract.useless_if.join('; ')}`),
    ];
    return {
        id,
        cycle_id: doc.cycle_id,
        cycle_goal: doc.cycle_goal,
        source_path: source.sourceRelativePath,
        capability_title: title,
        user_job: contract.user_job,
        first_meaningful_use: contract.first_meaningful_use,
        loop,
        steps,
        useless_if: contract.useless_if,
        maturity_ladder: contract.maturity_ladder,
        not_done_until: contract.not_done_until,
        runtime_qa_flow: {
            id: runtimeFlowId,
            path: `tests/runtime-qa/${runtimeFlowId}.spec.ts`,
            verifies: Array.from(new Set([
                contract.user_job,
                contract.first_meaningful_use,
                contract.maturity_ladder.v0,
                contract.maturity_ladder.v1,
                contract.maturity_ladder.v2,
                ...contract.not_done_until,
            ])),
            spec: `${loop.setup} ${loop.start} ${loop.core_action} ${loop.exit} ${loop.return} ${loop.continue_with_context}`,
        },
        dogfood_prompt: `Run the loop manually: ${loop.start}; leave; return; continue with preserved context; record whether "${contract.user_job}" was actually achieved.`,
        evidence_required: [
            `${PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH} scenario ${id}`,
            '.omc/runtime-qa.json flow declaration using runtime_qa_flow.verifies',
            '.omc/handoffs/runtime-qa/current.json with status passed, or explicit dogfood evidence',
        ],
    };
}
function step(order, phase, action, expectedState) {
    return {
        order,
        phase,
        action,
        expected_state: expectedState,
    };
}
function buildGaps(sources, scenarios) {
    const gaps = [];
    if (sources.length === 0) {
        gaps.push({
            severity: 'warning',
            code: 'no-cycle-sources',
            subject: 'product',
            message: 'No cycle documents exist, so no scenario can be generated.',
            recommended_action: 'Create a product cycle with feature_expectation_contract, then run omc scenario-generator generate --write.',
        });
    }
    for (const source of sources) {
        if (hasUsableExpectation(source.document.spec.feature_expectation_contract))
            continue;
        gaps.push({
            severity: 'error',
            code: 'missing-feature-expectation',
            subject: source.document.cycle_id,
            message: 'Cycle spec cannot generate a meaningful scenario without feature_expectation_contract.',
            recommended_action: 'Add user_job, first_meaningful_use, useless_if, v0/v1/v2 maturity ladder, and not_done_until.',
        });
    }
    for (const scenario of scenarios) {
        if (!scenario.steps.some((entry) => entry.phase === 'return')) {
            gaps.push({
                severity: 'error',
                code: 'missing-return-step',
                subject: scenario.id,
                message: 'Generated scenario is missing the return-session step.',
                recommended_action: 'Regenerate the scenario from a complete feature expectation contract.',
            });
        }
    }
    return gaps;
}
function hasUsableExpectation(contract) {
    if (!contract)
        return false;
    return [
        contract.user_job,
        contract.first_meaningful_use,
        contract.maturity_ladder?.v0,
        contract.maturity_ladder?.v1,
        contract.maturity_ladder?.v2,
        ...contract.useless_if,
        ...contract.not_done_until,
    ].every((value) => typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER_PATTERN.test(value));
}
function determineStatus(cycleCount, scenarioCount, gaps) {
    if (cycleCount === 0)
        return 'empty';
    if (scenarioCount === 0)
        return 'needs-expectation';
    if (gaps.some((gap) => gap.severity === 'error'))
        return 'partial';
    return 'ready';
}
function nextAction(status) {
    if (status === 'empty')
        return 'Create a product cycle with feature_expectation_contract, then run omc scenario-generator generate --write';
    if (status === 'needs-expectation')
        return 'Backfill feature_expectation_contract before scenario generation can produce useful proof';
    if (status === 'partial')
        return 'Fix missing feature expectations, then rerun omc scenario-generator generate --write';
    return 'Add generated runtime_qa_flow declarations to .omc/runtime-qa.json, run runtime QA, then audit scenario coverage';
}
function mergeRuntimeQaConfig(existing, detected) {
    if (!existing)
        return detected;
    return {
        ...detected,
        ...existing,
        commands: existing.commands ?? detected.commands,
        mobile: existing.mobile ?? detected.mobile,
        flows: existing.flows ?? detected.flows,
    };
}
function hasExecutableRuntimeHarness(config) {
    return Boolean(config.commands?.build
        || config.commands?.start
        || config.commands?.readiness
        || config.commands?.smoke
        || config.mobile?.command);
}
function flowKey(flow) {
    return `${flow.id ?? ''}::${flow.path}`;
}
function scenarioRuntimeQaNextAction(status) {
    if (status === 'no-scenarios')
        return 'Generate scenarios from feature_expectation_contract before applying runtime QA.';
    if (status === 'needs-harness')
        return 'Add Playwright, Maestro, dogfood, or project-script smoke commands before generated scenarios can execute.';
    if (status === 'current')
        return 'Runtime QA config already carries generated scenario flows; run omc runtime-qa run --auto --json.';
    return 'Run omc runtime-qa run --auto --json, then rerun omc scenario-coverage audit --write.';
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        || 'scenario';
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=scenario-generator.js.map
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import { generateHistoricalScorecard, } from './historical-scorecard.js';
import { PRODUCT_TOTALITY_JSON_RELATIVE_PATH, generateProductTotalityAudit, } from './product-totality.js';
import { PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH, generateProductScenarioCoverageAudit, } from './scenario-coverage.js';
export const PRODUCT_REGRESSION_JSON_RELATIVE_PATH = '.omc/product/regression/current.json';
export const PRODUCT_REGRESSION_MD_RELATIVE_PATH = '.omc/product/regression/current.md';
const REGRESSION_STOP_WORDS = new Set([
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
export function generateProductRegressionAudit(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const totality = options.totality ?? generateProductTotalityAudit(root);
    const scenarioCoverage = options.scenarioCoverage ?? generateProductScenarioCoverageAudit({ root, totality });
    const historical = options.historical ?? generateHistoricalScorecard(root);
    const debts = historical.totals.cycles === 0
        ? []
        : dedupeDebts([
            ...learningDebts(historical, totality, scenarioCoverage),
            ...capabilityDebts(totality),
            ...scenarioDebts(scenarioCoverage),
            ...historicalTrendDebts(historical),
        ]);
    const status = determineStatus(historical.totals.cycles, debts);
    const sourceArtifacts = Array.from(new Set([
        PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
        PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH,
        ...totality.source_artifacts,
        ...scenarioCoverage.source_artifacts,
        ...historical.cycles.map((cycle) => normalizePath(cycle.source_path, root)),
    ])).sort();
    return {
        schema_version: 1,
        generated_at: (options.now ?? new Date()).toISOString(),
        root,
        status,
        source_artifacts: sourceArtifacts,
        aggregates: {
            cycles: historical.totals.cycles,
            completed_cycles: historical.totals.completed,
            regression_debts: debts.length,
            error_debts: debts.filter((debt) => debt.severity === 'error').length,
            warning_debts: debts.filter((debt) => debt.severity === 'warning').length,
            scenario_proof_debts: debts.filter((debt) => debt.category === 'scenario-proof').length,
            learning_debts: debts.filter((debt) => debt.category === 'learning').length,
        },
        debts,
        next_action: nextAction(status),
    };
}
export function writeProductRegressionAudit(root = process.cwd(), report = generateProductRegressionAudit({ root })) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, PRODUCT_REGRESSION_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_REGRESSION_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, report);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductRegressionAudit(report), 'utf-8');
    return { jsonPath, mdPath };
}
export function renderProductRegressionAudit(report) {
    const debtRows = report.debts.map((debt) => (`| ${debt.severity} | ${debt.category} | ${escapeCell(debt.subject)} | ${escapeCell(debt.recommended_action)} |`));
    return [
        '# Product Regression Audit',
        '',
        `status: ${report.status}`,
        `generated_at: ${report.generated_at}`,
        `schema_source: ${PRODUCT_REGRESSION_JSON_RELATIVE_PATH}`,
        '',
        '## Aggregates',
        `- cycles: ${report.aggregates.cycles}`,
        `- completed_cycles: ${report.aggregates.completed_cycles}`,
        `- regression_debts: ${report.aggregates.regression_debts}`,
        `- error_debts: ${report.aggregates.error_debts}`,
        `- warning_debts: ${report.aggregates.warning_debts}`,
        `- scenario_proof_debts: ${report.aggregates.scenario_proof_debts}`,
        `- learning_debts: ${report.aggregates.learning_debts}`,
        '',
        '## Regression And Learning Debt',
        '| Severity | Category | Subject | Recommended Action |',
        '| --- | --- | --- | --- |',
        ...(debtRows.length > 0 ? debtRows : ['| warning | learning | product | No regression debts detected |']),
        '',
        '## Source Artifacts',
        ...report.source_artifacts.map((source) => `- ${source}`),
        '',
        `next_action: ${report.next_action}`,
        '',
    ].join('\n');
}
function learningDebts(historical, totality, scenarioCoverage) {
    const debts = [];
    const representedText = [
        ...totality.capabilities.map((capability) => [
            capability.title,
            capability.user_job ?? '',
            capability.first_meaningful_use ?? '',
            capability.missing_depth.join(' '),
        ].join(' ')),
        ...totality.recommended_moves.map((move) => `${move.title} ${move.why}`),
        ...scenarioCoverage.scenarios.map((scenario) => `${scenario.expected_user_loop} ${scenario.recommended_action}`),
    ].join('\n');
    for (const cycle of historical.cycles.filter((entry) => entry.cycle_stage === 'complete')) {
        if (!cycle.has_learning_capture) {
            debts.push({
                id: `${cycle.cycle_id}-missing-learning`,
                severity: 'error',
                category: 'learning',
                subject: cycle.cycle_id,
                source_cycle: cycle.cycle_id,
                message: 'Completed cycle has no learning capture, so its outcome cannot be compared against future work.',
                recommended_action: 'Backfill the learning capture before using this cycle as completion evidence.',
                evidence: [cycle.source_path],
            });
        }
        const recommendation = cycle.learning_recommended_next_cycle;
        if (recommendation && !fuzzyMentions(representedText, recommendation)) {
            debts.push({
                id: `${cycle.cycle_id}-learning-recommendation-not-carried`,
                severity: 'warning',
                category: 'learning',
                subject: cycle.cycle_id,
                source_cycle: cycle.cycle_id,
                message: `Learning recommended next cycle is not represented in totality, scenario coverage, or recommended moves: ${recommendation}`,
                recommended_action: 'Carry this learning into priority-engine as explicit learning debt or explain why it was invalidated.',
                evidence: [cycle.source_path],
            });
        }
    }
    return debts;
}
function capabilityDebts(totality) {
    const debts = [];
    for (const capability of totality.capabilities) {
        if (capability.maturity === 'missing-expectation') {
            debts.push(capabilityDebt(capability, 'error', 'evidence', 'Capability is complete in a cycle but lacks an expectation contract.', 'Backfill feature expectation before any future cycle treats this as done.'));
        }
        if (capability.missing_depth.length > 0) {
            debts.push(capabilityDebt(capability, 'warning', 'capability-depth', 'Capability still has unrepresented v1/v2 or not-done-until depth.', 'Keep missing maturity depth in priority-engine until represented in roadmap, scenario coverage, or portfolio work.'));
        }
    }
    for (const orphan of totality.capability_graph.orphan_capabilities) {
        debts.push({
            id: `${orphan.capability_id}-orphan-regression`,
            severity: orphan.severity,
            category: 'orphan',
            subject: orphan.title,
            source_cycle: totality.capabilities.find((capability) => capability.id === orphan.capability_id)?.source_cycle,
            message: `Capability remains orphaned in the graph: ${orphan.reasons.join('; ')}.`,
            recommended_action: orphan.recommended_action,
            evidence: orphan.evidence,
        });
    }
    return debts;
}
function scenarioDebts(scenarioCoverage) {
    return scenarioCoverage.gaps.map((gap) => ({
        id: `${slugify(gap.subject)}-${gap.code}`,
        severity: gap.severity,
        category: 'scenario-proof',
        subject: gap.subject,
        message: gap.message,
        recommended_action: gap.recommended_action,
        evidence: [PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH],
    }));
}
function historicalTrendDebts(historical) {
    return historical.comparison.regressions.map((regression) => ({
        id: `${slugify(regression)}-trend-regression`,
        severity: 'warning',
        category: 'quality-regression',
        subject: historical.comparison.latest?.cycle_id ?? 'historical scorecard',
        source_cycle: historical.comparison.latest?.cycle_id,
        message: regression,
        recommended_action: 'Inspect the latest cycle before selecting unrelated new work.',
        evidence: [historical.comparison.latest?.source_path ?? '.omc/cycles'],
    }));
}
function capabilityDebt(capability, severity, category, message, recommendedAction) {
    return {
        id: `${capability.id}-${category}`,
        severity,
        category,
        subject: capability.title,
        source_cycle: capability.source_cycle,
        message,
        recommended_action: recommendedAction,
        evidence: capability.evidence,
    };
}
function determineStatus(cycleCount, debts) {
    if (cycleCount === 0)
        return 'empty';
    if (debts.some((debt) => debt.severity === 'error' && debt.category !== 'scenario-proof'))
        return 'needs-repair';
    if (debts.some((debt) => debt.category === 'scenario-proof'))
        return 'needs-scenario-proof';
    if (debts.length > 0)
        return 'carrying-debt';
    return 'stable';
}
function nextAction(status) {
    if (status === 'empty')
        return 'Complete a product-cycle, then run omc product-regression audit --write';
    if (status === 'needs-repair')
        return 'Repair regression audit errors before selecting unrelated new work';
    if (status === 'needs-scenario-proof')
        return 'Run or add scenario coverage for unproven capabilities before calling them complete';
    if (status === 'carrying-debt')
        return 'Feed regression debts into priority-engine as first-class candidate work';
    return 'Regression audit is stable; continue with priority-engine using current totality and scenario evidence';
}
function dedupeDebts(debts) {
    const seen = new Set();
    const out = [];
    for (const debt of debts) {
        const key = `${debt.id}:${debt.subject}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(debt);
    }
    return out;
}
function fuzzyMentions(haystack, needle) {
    const tokens = keywords(needle);
    if (tokens.length === 0)
        return true;
    const normalized = normalize(haystack);
    const hits = tokens.filter((token) => normalized.includes(token));
    return hits.length >= Math.min(2, tokens.length);
}
function keywords(value) {
    return Array.from(new Set(value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 3 && !REGRESSION_STOP_WORDS.has(token))))
        .slice(0, 12);
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}
function normalizePath(path, root) {
    return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, '/') : path.replace(/\\/g, '/');
}
function slugify(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'product';
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=product-regression.js.map
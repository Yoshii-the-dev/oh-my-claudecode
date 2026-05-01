import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH, PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH, generateProductScenarioPlan, writeProductScenarioPlan, } from '../scenario-generator.js';
import { generateProductScenarioCoverageAudit } from '../scenario-coverage.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('generateProductScenarioPlan', () => {
    it('reports empty when no cycle source exists', () => {
        const root = createRoot();
        const report = generateProductScenarioPlan(root, new Date('2026-04-25T00:00:00.000Z'));
        expect(report.status).toBe('empty');
        expect(report.gaps.map((gap) => gap.code)).toContain('no-cycle-sources');
    });
    it('generates a return-session scenario from feature expectation contract', () => {
        const root = createRoot();
        writeCycleArtifact(root);
        const report = generateProductScenarioPlan(root, new Date('2026-04-25T00:00:00.000Z'));
        expect(report.status).toBe('ready');
        expect(report.scenarios).toHaveLength(1);
        expect(report.scenarios[0]).toEqual(expect.objectContaining({
            cycle_id: '2026-04-25-row-reader',
            capability_title: 'resume a row-reading session without losing place',
            first_meaningful_use: 'open a sample pattern, advance rows, close, and resume on the next row',
        }));
        expect(report.scenarios[0]?.steps.map((step) => step.phase)).toEqual([
            'setup',
            'start',
            'core-action',
            'state-change',
            'exit',
            'return',
            'continue-with-context',
            'proof',
        ]);
        expect(report.scenarios[0]?.runtime_qa_flow.verifies).toContain('remembers pattern context and return-session state');
    });
    it('reports missing expectation when a cycle cannot produce a meaningful scenario', () => {
        const root = createRoot();
        writeCycleArtifact(root, { expectation: false });
        const report = generateProductScenarioPlan(root, new Date('2026-04-25T00:00:00.000Z'));
        expect(report.status).toBe('needs-expectation');
        expect(report.gaps.map((gap) => gap.code)).toContain('missing-feature-expectation');
    });
    it('writes JSON and markdown projections', () => {
        const root = createRoot();
        writeCycleArtifact(root);
        const written = writeProductScenarioPlan(root);
        expect(written.jsonPath).toContain(PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH);
        expect(written.mdPath).toContain(PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH);
        expect(existsSync(join(root, PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH))).toBe(true);
        expect(existsSync(join(root, PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH))).toBe(true);
    });
    it('lets scenario coverage treat generated scenarios as declared proof targets', () => {
        const root = createRoot();
        writeCycleArtifact(root, { stage: 'complete' });
        writeLearningArtifact(root);
        writeProductScenarioPlan(root);
        const report = generateProductScenarioCoverageAudit({ root });
        expect(report.status).toBe('needs-runtime-evidence');
        expect(report.scenarios[0]?.coverage).toBe('declared');
        expect(report.scenarios[0]?.evidence).toContain(PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH);
        expect(report.gaps.map((gap) => gap.code)).toContain('scenario-declared-not-run');
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-scenario-generator-'));
    rootsToClean.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${content}\n`, 'utf-8');
}
function writeCycleArtifact(root, options = {}) {
    const includeExpectation = options.expectation !== false;
    writeArtifact(root, '.omc/cycles/current.json', JSON.stringify({
        schema_version: 1,
        cycle_id: '2026-04-25-row-reader',
        cycle_goal: 'ship row reader seed',
        cycle_stage: options.stage ?? 'spec',
        product_stage: 'pre-mvp',
        stage_checklist: {
            discover: true,
            rank: true,
            select: true,
            spec: true,
            build: options.stage === 'complete',
            verify: options.stage === 'complete',
            learn: options.stage === 'complete',
        },
        selected_portfolio: {
            core_product_slice: 'resume a row-reading session without losing place',
            enabling_task: 'persist project row state',
            learning_task: 'founder dogfood row-reading walkthrough',
        },
        spec: {
            acceptance_criteria: ['can increment and persist current row'],
            build_route: 'product-pipeline',
            verification_plan: ['runtime QA row-reader return-session smoke'],
            learning_plan: ['dogfood a sample pattern'],
            ...(includeExpectation ? {
                feature_expectation_contract: {
                    user_job: 'continue a knitting pattern without losing place',
                    first_meaningful_use: 'open a sample pattern, advance rows, close, and resume on the next row',
                    useless_if: ['row value is isolated from pattern context'],
                    maturity_ladder: {
                        v0: 'manual row state persists',
                        v1: 'remembers pattern context and return-session state',
                        v2: 'coordinates row state with project history and mistake recovery',
                    },
                    not_done_until: ['users can resume without losing row context'],
                },
            } : {}),
        },
        footer: {
            status: 'ok',
            evidence: ['fixture'],
            confidence: 0.7,
            blocking_issues: [],
            next_action: 'generate scenarios',
            artifacts_written: ['.omc/cycles/current.json'],
        },
        history: [{ stage: 'spec', at: '2026-04-25T00:00:00.000Z' }],
        updated_at: '2026-04-25T00:00:00.000Z',
    }, null, 2));
}
function writeLearningArtifact(root) {
    writeArtifact(root, '.omc/learning/current.json', JSON.stringify({
        schema_version: 1,
        cycle_id: '2026-04-25-row-reader',
        shipped_outcome: 'Manual row state persists across return sessions.',
        evidence_collected: ['fixture'],
        user_product_learning: ['return-session context mattered more than a standalone counter'],
        invalidated_assumptions: ['a naked counter is enough'],
        recommended_next_cycle: 'deepen row reader with project history',
        next_candidate_adjustments: ['add v2 recovery depth'],
        footer: {
            status: 'ok',
            evidence: ['fixture'],
            confidence: 0.8,
            blocking_issues: [],
            next_action: 'run scenario coverage',
            artifacts_written: ['.omc/learning/current.json'],
        },
        captured_at: '2026-04-25T00:00:00.000Z',
    }, null, 2));
}
//# sourceMappingURL=scenario-generator.test.js.map
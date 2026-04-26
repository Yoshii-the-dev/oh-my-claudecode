import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceProductCycle, readProductCycle } from '../cycle-fsm.js';
import { runProductCycle } from '../cycle-runner.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('runProductCycle', () => {
    it('returns missing-goal when cycle does not exist and no goal is provided', () => {
        const root = createRoot();
        const report = runProductCycle({ root });
        expect(report.ok).toBe(false);
        expect(report.stoppedReason).toBe('missing-goal');
        expect(report.pauseInstruction).toContain('--goal');
    });
    it('bootstraps a discover-stage cycle when goal is provided', () => {
        const root = createRoot();
        const report = runProductCycle({ root, goal: 'ship first usable loop' });
        const snapshot = readProductCycle(root);
        expect(snapshot.exists).toBe(true);
        expect(snapshot.stage).toBe('discover');
        expect(report.stoppedReason).toBe('pause-for-llm');
        expect(report.pauseInstruction).toContain('product-foundation');
    });
    it('advances discover -> rank when capability map is present and stops at rank for missing portfolio', () => {
        const root = createRoot();
        advanceProductCycle({ root, to: 'discover', goal: 'ship first usable loop' });
        writeArtifact(root, '.omc/product/capability-map/current.md', '# capability map');
        writeArtifact(root, '.omc/ecosystem/current.md', '# ecosystem');
        const report = runProductCycle({ root });
        expect(report.stagesAdvanced.map((entry) => `${entry.from}->${entry.to}`)).toContain('discover->rank');
        expect(report.stoppedReason).toBe('pause-for-llm');
        expect(report.pauseInstruction).toContain('priority-engine');
    });
    it('reports pause-for-human when select stage is missing portfolio trio', () => {
        const root = createRoot();
        setupCycleAt(root, 'select', '2026-04-25-first');
        writePortfolioLedger(root, '2026-04-25-first', { core: false, enabling: true, learning: true });
        const report = runProductCycle({ root });
        expect(report.stoppedReason).toBe('pause-for-human');
        expect(report.stageResults.at(-1)?.reason).toContain('core-product-slice');
    });
    it('runs verify command and advances when exit code is zero', () => {
        const root = createRoot();
        setupCycleAt(root, 'verify');
        writeArtifact(root, '.omc/learning/current.md', learningArtifact());
        const report = runProductCycle({ root, verifyCommand: 'true' });
        const verifyResult = report.stageResults.find((entry) => entry.stage === 'verify');
        expect(verifyResult?.outcome).toBe('advance');
        expect(report.stagesAdvanced.map((entry) => `${entry.from}->${entry.to}`)).toContain('verify->learn');
    });
    it('stops with verify-failed when the verify command exits non-zero', () => {
        const root = createRoot();
        setupCycleAt(root, 'verify');
        const report = runProductCycle({ root, verifyCommand: 'false' });
        expect(report.stoppedReason).toBe('verify-failed');
        const verifyResult = report.stageResults.find((entry) => entry.stage === 'verify');
        expect(verifyResult?.outcome).toBe('verify-failed');
    });
    it('respects --dry-run and does not mutate the cycle file', () => {
        const root = createRoot();
        advanceProductCycle({ root, to: 'discover', goal: 'ship first usable loop' });
        writeArtifact(root, '.omc/product/capability-map/current.md', '# capability map');
        const before = readProductCycle(root);
        const report = runProductCycle({ root, dryRun: true });
        const after = readProductCycle(root);
        expect(after.stage).toBe(before.stage);
        expect(report.stagesAdvanced.length).toBeGreaterThan(0);
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-cycle-runner-'));
    rootsToClean.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function setupCycleAt(root, stage, cycleId = '2026-04-25-first') {
    writeArtifact(root, '.omc/cycles/current.md', `# Product Cycle: ship loop

cycle_id: ${cycleId}
cycle_stage: ${stage}
product_stage: pre-mvp

## Stage Checklist
- [x] discover
- [x] rank
- [x] select
- [x] spec
- [x] build
- [ ] verify
- [ ] learn

## Selected Cycle Portfolio
core_product_slice: import/open sample pattern -> row track -> persist progress -> resume next session
enabling_task: local progress persistence
learning_task: design partner row-tracking session

## Cycle Spec
acceptance_criteria:
  - user can resume the next row after reopening the app
build_route: product-pipeline
verification_plan:
  - npm test
learning_plan:
  - observe one design partner

status: ok
evidence: fixture
confidence: 0.6
blocking_issues: none
next_action: run tests
artifacts_written: .omc/cycles/current.md
`);
}
function writePortfolioLedger(root, cycleId, includes) {
    const items = [];
    if (includes.core) {
        items.push({
            id: 'core-loop',
            title: 'First reader loop',
            lane: 'product',
            type: 'core-product-slice',
            status: 'selected',
            confidence: 'MEDIUM',
            dependencies: [],
            selected_cycle: cycleId,
            evidence: ['fixture'],
        });
    }
    if (includes.enabling) {
        items.push({
            id: 'progress-storage',
            title: 'Progress persistence',
            lane: 'backend',
            type: 'enabling',
            status: 'selected',
            confidence: 'MEDIUM',
            dependencies: [],
            selected_cycle: cycleId,
            evidence: ['fixture'],
        });
    }
    if (includes.learning) {
        items.push({
            id: 'design-partner',
            title: 'Design partner session',
            lane: 'research',
            type: 'learning',
            status: 'selected',
            confidence: 'MEDIUM',
            dependencies: [],
            selected_cycle: cycleId,
            evidence: ['fixture'],
        });
    }
    const ledger = {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        source_artifacts: ['.omc/opportunities/current.md'],
        items,
    };
    writeArtifact(root, '.omc/portfolio/current.json', `${JSON.stringify(ledger, null, 2)}\n`);
}
function learningArtifact() {
    return `# Learning

## Shipped outcome
First usable loop shipped.

## Evidence collected
Two design partners completed the loop.

## User/product learning
Resume-on-row was the key value.

## Invalidated assumptions
Users did not need a built-in chart editor in week 1.

## Recommended next cycle
Iterate on resume telemetry.

status: ok
evidence: fixture
confidence: 0.7
blocking_issues: none
next_action: start next cycle
artifacts_written: .omc/learning/current.md
`;
}
//# sourceMappingURL=cycle-runner.test.js.map
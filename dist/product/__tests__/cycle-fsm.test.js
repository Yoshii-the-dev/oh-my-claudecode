import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceProductCycle, readProductCycle, validateProductCycle, } from '../cycle-fsm.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('product cycle FSM', () => {
    it('reports a missing cycle with a start action', () => {
        const root = createRoot();
        const snapshot = readProductCycle(root);
        expect(snapshot.exists).toBe(false);
        expect(snapshot.nextAction).toContain('advance --to discover');
        expect(snapshot.issues[0]?.code).toBe('missing-cycle');
    });
    it('creates a new cycle at discover', () => {
        const root = createRoot();
        const result = advanceProductCycle({
            root,
            to: 'discover',
            goal: 'ship first usable loop',
        });
        expect(result.ok).toBe(true);
        expect(result.snapshot.exists).toBe(true);
        expect(result.snapshot.stage).toBe('discover');
        expect(readFileSync(join(root, '.omc/cycles/current.md'), 'utf-8')).toContain('cycle_goal: ship first usable loop');
    });
    it('blocks illegal jumps without force', () => {
        const root = createRoot();
        advanceProductCycle({ root, to: 'discover', goal: 'ship first usable loop' });
        const result = advanceProductCycle({ root, to: 'select' });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('illegal-transition');
    });
    it('allows the next legal transition and updates stage checklist', () => {
        const root = createRoot();
        advanceProductCycle({ root, to: 'discover', goal: 'ship first usable loop' });
        const result = advanceProductCycle({ root, to: 'rank' });
        const content = readFileSync(join(root, '.omc/cycles/current.md'), 'utf-8');
        expect(result.ok).toBe(true);
        expect(result.from).toBe('discover');
        expect(result.snapshot.stage).toBe('rank');
        expect(content).toContain('- [x] discover');
        expect(content).toContain('- [x] rank');
    });
    it('blocks select until priority-handoff contract passes', () => {
        const root = createRoot();
        writeCycle(root, cycleArtifact('rank'));
        const result = advanceProductCycle({ root, to: 'select' });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('priority-contract-failed');
    });
    it('validates cycle spec before build', () => {
        const root = createRoot();
        writeCycle(root, cycleArtifact('spec'));
        const result = advanceProductCycle({ root, to: 'build' });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('cycle-contract-failed');
    });
    it('requires learning artifact before completion', () => {
        const root = createRoot();
        writeCycle(root, cycleArtifact('learn'));
        const result = advanceProductCycle({ root, to: 'complete' });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('learning-missing');
    });
    it('marks complete after learning capture exists', () => {
        const root = createRoot();
        writeCycle(root, cycleArtifact('learn'));
        writePriorityArtifacts(root);
        writeArtifact(root, '.omc/learning/current.md', learningArtifact());
        const result = advanceProductCycle({ root, to: 'complete' });
        const validated = validateProductCycle(root);
        expect(result.ok).toBe(true);
        expect(result.snapshot.stage).toBe('complete');
        expect(validated.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-cycle-fsm-'));
    rootsToClean.push(root);
    return root;
}
function writeCycle(root, content) {
    writeArtifact(root, '.omc/cycles/current.md', content);
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function cycleArtifact(stage) {
    return `# Product Cycle: first usable loop

cycle_id: 2026-04-25-first-loop
cycle_goal: first usable loop
cycle_stage: ${stage}
product_stage: pre-mvp

## Stage Checklist
- [x] discover
- [x] rank
- [x] select
- [x] spec
- [ ] build
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
  - observe one design partner using the reader loop
experience_gate: .omc/experience/current.md

## Completion Evidence
- .omc/learning/current.md

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: continue
artifacts_written: .omc/cycles/current.md
`;
}
function learningArtifact() {
    return `# Product Cycle Learning

## Shipped outcome
First usable loop shipped.

## Evidence collected
Test fixture.

## User/product learning
Users need resume state.

## Invalidated assumptions
None.

## Recommended next cycle
Improve reader precision.

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: plan next cycle
artifacts_written: .omc/learning/current.md
`;
}
function writePriorityArtifacts(root) {
    writeArtifact(root, '.omc/portfolio/current.json', portfolioLedgerArtifact());
    writeArtifact(root, '.omc/opportunities/current.md', opportunitiesArtifact());
    writeArtifact(root, '.omc/roadmap/current.md', roadmapArtifact());
    writeArtifact(root, '.omc/experience/current.md', experienceGateArtifact());
}
function portfolioLedgerArtifact() {
    const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'];
    const selectedCycle = '2026-04-25-first-loop';
    const items = Array.from({ length: 20 }, (_, index) => ({
        id: `move-${index + 1}`,
        title: index === 0 ? 'First reader loop' : `Move ${index + 1}`,
        lane: lanes[index % lanes.length],
        type: index === 0 ? 'core-product-slice' : index === 1 ? 'enabling' : index === 2 ? 'learning' : 'quality',
        status: index < 3 ? 'selected' : 'candidate',
        user_visible: index === 0,
        confidence: index % 2 === 0 ? 'HIGH' : 'MEDIUM',
        dependencies: index === 1 ? ['move-1'] : [],
        selected_cycle: index < 3 ? selectedCycle : null,
        evidence: ['fixture'],
        expected_learning: 'Fixture learning',
        dependency_unlock: 'Fixture unlock',
    }));
    return JSON.stringify({
        schema_version: 1,
        updated_at: '2026-04-25T00:00:00.000Z',
        source_artifacts: ['.omc/opportunities/current.md'],
        items,
    }, null, 2);
}
function opportunitiesArtifact() {
    const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'];
    const rows = Array.from({ length: 20 }, (_, index) => {
        const lane = lanes[index % lanes.length];
        const confidence = index % 2 === 0 ? 'HIGH' : 'MEDIUM';
        return `| move-${index + 1} | ${lane} | evidence | ${confidence} | learning |`;
    }).join('\n');
    return `# Opportunities

status: ok

| Candidate | Lane | Evidence | Confidence | Expected learning |
| --- | --- | --- | --- | --- |
${rows}

## Selected Cycle Portfolio
- 1 core product slice: first reader loop
- 1 enabling task: progress storage
- 1 learning/research task: design partner row-tracking session

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: write cycle spec
artifacts_written: .omc/opportunities/current.md
`;
}
function roadmapArtifact() {
    return `# Roadmap

## Rolling 2-week window
Ship first usable loop.

## Rolling 6-week window
Improve reader, persistence, and sample library.

## Rolling 12-week window
Expand creator and content loops.

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: start product cycle build
artifacts_written: .omc/roadmap/current.md
`;
}
function experienceGateArtifact() {
    return `# Experience Gate

## User Journey
Open a sample pattern, track the current row, persist progress, and resume next session.

## Empty States
Sample pattern and import/open action are visible.

## Failure States
Persistence failure keeps current row visible and offers retry.

## Return Session
The next session opens on the next row.

## Perceived Value
The user immediately sees reduced lost-place work.

## UX Verdict
pass: ready-for-build

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: build
artifacts_written: .omc/experience/current.md
`;
}
//# sourceMappingURL=cycle-fsm.test.js.map
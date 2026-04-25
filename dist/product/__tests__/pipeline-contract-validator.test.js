import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductPipelineContracts } from '../pipeline-contract-validator.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('validateProductPipelineContracts', () => {
    it('passes a complete foundation-lite artifact set', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root);
        const report = validateProductPipelineContracts({ root, stage: 'foundation-lite' });
        expect(report.ok).toBe(true);
        expect(report.summary.errors).toBe(0);
        expect(report.issues.map((issue) => issue.code)).not.toContain('too-few-candidates');
        expect(metric(report, 'opportunities', 'candidateCount')).toBe(20);
        expect(metric(report, 'opportunities', 'laneCount')).toBe(7);
    });
    it('treats missing foundation-lite artifacts as handoff errors', () => {
        const root = createRoot();
        const report = validateProductPipelineContracts({ root, stage: 'foundation-lite' });
        expect(report.ok).toBe(false);
        expect(report.summary.errors).toBe(5);
        expect(report.summary.warnings).toBe(1);
        expect(codes(report)).toEqual(expect.arrayContaining([
            'missing-artifact',
        ]));
    });
    it('allows a smaller opportunity set only when status is needs-research', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root, {
            opportunities: opportunitiesArtifact({
                status: 'needs-research',
                count: 12,
            }),
        });
        const report = validateProductPipelineContracts({ root, stage: 'foundation-lite' });
        expect(report.ok).toBe(true);
        expect(metric(report, 'opportunities', 'candidateCount')).toBe(12);
    });
    it('fails when opportunity generation collapses into a short shortlist', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root, {
            opportunities: opportunitiesArtifact({
                status: 'ready',
                count: 7,
            }),
        });
        const report = validateProductPipelineContracts({ root, stage: 'foundation-lite' });
        expect(report.ok).toBe(false);
        expect(codes(report)).toContain('too-few-candidates');
    });
    it('fails direct technology handoff before the priority engine', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root, {
            capability: capabilityMapArtifact('technology-strategist'),
        });
        const report = validateProductPipelineContracts({ root, stage: 'technology-handoff' });
        expect(report.ok).toBe(false);
        expect(codes(report)).toContain('technology-before-priority');
    });
    it('requires the meaning graph in all-stage validation', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root);
        const foundationLite = validateProductPipelineContracts({ root, stage: 'foundation-lite' });
        const all = validateProductPipelineContracts({ root, stage: 'all' });
        expect(foundationLite.issues.find((issue) => issue.artifact === 'meaning')?.severity).toBe('warning');
        expect(all.issues.find((issue) => issue.artifact === 'meaning')?.severity).toBe('error');
    });
    it('validates the product cycle controller spec before build', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root);
        writeArtifact(root, '.omc/cycles/current.md', cycleArtifact('spec'));
        writeArtifact(root, '.omc/experience/current.md', experienceGateArtifact());
        const report = validateProductPipelineContracts({ root, stage: 'cycle' });
        expect(report.ok).toBe(true);
        expect(metric(report, 'cycle', 'cycleStage')).toBe('spec');
        expect(report.issues.find((issue) => issue.artifact === 'learning')?.severity).toBe('warning');
    });
    it('blocks user-facing cycle build when experience gate is missing', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root);
        writeArtifact(root, '.omc/cycles/current.md', cycleArtifact('spec'));
        const report = validateProductPipelineContracts({ root, stage: 'cycle' });
        expect(report.ok).toBe(false);
        expect(codes(report)).toContain('missing-experience-gate');
    });
    it('blocks a completed cycle that does not reference learning capture', () => {
        const root = createRoot();
        writeFoundationLiteArtifacts(root);
        writeArtifact(root, '.omc/cycles/current.md', cycleArtifact('complete', false));
        writeArtifact(root, '.omc/experience/current.md', experienceGateArtifact());
        const report = validateProductPipelineContracts({ root, stage: 'cycle' });
        expect(report.ok).toBe(false);
        expect(codes(report)).toContain('complete-without-learning');
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-contracts-'));
    rootsToClean.push(root);
    return root;
}
function writeFoundationLiteArtifacts(root, overrides = {}) {
    writeArtifact(root, '.omc/product/capability-map/current.md', overrides.capability ?? capabilityMapArtifact());
    writeArtifact(root, '.omc/ecosystem/current.md', overrides.ecosystem ?? ecosystemArtifact());
    writeArtifact(root, '.omc/portfolio/current.json', overrides.portfolio ?? portfolioLedgerArtifact());
    writeArtifact(root, '.omc/opportunities/current.md', overrides.opportunities ?? opportunitiesArtifact());
    writeArtifact(root, '.omc/roadmap/current.md', overrides.roadmap ?? roadmapArtifact());
    if (overrides.meaning) {
        writeArtifact(root, '.omc/meaning/current.md', overrides.meaning);
    }
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function capabilityMapArtifact(nextAgent = 'priority-engine') {
    return `# Capability Map

## MVP Feature Set
- Reader shell

## First Usable Loop
Import/open sample pattern -> row track -> persist progress -> resume next session.

## Required Product Systems
- Pattern reader
- Progress persistence

## Retention
Return to the next row without setup.

## Launch Readiness
Invite design partners after the loop is usable.

## Backend/Product Split
Backend work is limited to the storage contract needed by the first loop.

run_id: test
agent_role: product-strategist
requested_next_agent: ${nextAgent}
artifacts_produced:
  - .omc/product/capability-map/current.md
`;
}
function ecosystemArtifact() {
    return `# Ecosystem Map

## App Surfaces
Reader, library, progress dashboard.

## Content Loops
Sample patterns and creator walkthroughs.

## Data Loops
Progress history and pattern corrections.

## Distribution Loops
Searchable patterns and referral prompts.

## Integrations
PDF imports and marketplace links.

## Research Loop
Design partner interviews after each cycle.

## Depth Path
- v0: first usable loop
- v1: richer reader
- v2: creator/community layer
- research gate: observed repeat use

status: ready
evidence: fixture
confidence: medium
blocking_issues: none
next_action: run priority-engine
artifacts_written: .omc/ecosystem/current.md
`;
}
function portfolioLedgerArtifact(count = 20) {
    const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'];
    const selectedCycle = '2026-04-25-first-loop';
    const items = Array.from({ length: count }, (_, index) => {
        const id = `move-${index + 1}`;
        return {
            id,
            title: `Move ${index + 1}`,
            lane: lanes[index % lanes.length],
            type: index === 0 ? 'core-product-slice' : index === 1 ? 'enabling' : index === 2 ? 'learning' : 'quality',
            status: index < 3 ? 'selected' : 'candidate',
            user_visible: index === 0,
            confidence: index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW',
            dependencies: index === 1 ? ['move-1'] : [],
            selected_cycle: index < 3 ? selectedCycle : null,
            evidence: ['fixture'],
            expected_learning: 'Fixture learning',
            dependency_unlock: 'Fixture unlock',
        };
    });
    return JSON.stringify({
        schema_version: 1,
        updated_at: '2026-04-25T00:00:00.000Z',
        source_artifacts: ['.omc/product/capability-map/current.md'],
        items,
    }, null, 2);
}
function opportunitiesArtifact(options = {}) {
    const status = options.status ?? 'ready';
    const count = options.count ?? 20;
    const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'];
    const rows = Array.from({ length: count }, (_, index) => {
        const lane = lanes[index % lanes.length];
        const confidence = index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW';
        return `| move-${index + 1} | ${lane} | evidence | ${confidence} | learning |`;
    }).join('\n');
    return `# Opportunities

status: ${status}

| Candidate | Lane | Evidence | Confidence | Expected learning |
| --- | --- | --- | --- | --- |
${rows}

## Selected Cycle Portfolio
- 1 core product slice: first reader loop
- 1 enabling task: progress storage
- 1 learning/research task: design partner row-tracking session

status: ${status}
evidence: fixture
confidence: medium
blocking_issues: none
next_action: write rolling roadmap
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

status: ready
evidence: fixture
confidence: medium
blocking_issues: none
next_action: start product-pipeline
artifacts_written: .omc/roadmap/current.md
`;
}
function experienceGateArtifact() {
    return `# Experience Gate

## User Journey
Open a sample pattern, track the current row, save progress, and resume the next session.

## Empty States
Show sample pattern and clear import/open action.

## Failure States
Persist failure shows recovery copy and keeps local progress intact.

## Return Session
User returns to the exact next row.

## Perceived Value
The loop saves attention and reduces lost-place anxiety.

## UX Verdict
pass: ready-for-build

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: start product-pipeline
artifacts_written: .omc/experience/current.md
`;
}
function cycleArtifact(stage, includeLearningReference = true) {
    const learningReference = includeLearningReference ? '- .omc/learning/current.md' : '- verification report only';
    return `# Product Cycle: first usable loop

cycle_id: 2026-04-25-first-loop
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
${learningReference}

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: start build route
artifacts_written: .omc/cycles/current.md
`;
}
function codes(report) {
    return report.issues.map((issue) => issue.code);
}
function metric(report, artifactName, metricName) {
    return report.artifacts.find((artifact) => artifact.artifact === artifactName)?.metrics[metricName];
}
//# sourceMappingURL=pipeline-contract-validator.test.js.map
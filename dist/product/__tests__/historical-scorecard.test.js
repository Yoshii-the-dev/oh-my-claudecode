import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHistoricalScorecard } from '../historical-scorecard.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('generateHistoricalScorecard', () => {
    it('returns an empty report when .omc/cycles is missing', () => {
        const root = createRoot();
        const report = generateHistoricalScorecard(root);
        expect(report.totals.cycles).toBe(0);
        expect(report.cycles).toEqual([]);
        expect(report.comparison.improvements).toEqual([]);
        expect(report.comparison.regressions).toEqual([]);
    });
    it('builds summaries for two cycles and detects improvement trends', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/2026-04-25-first.md', completedCycleMarkdown({
            cycleId: '2026-04-25-first',
            goal: 'first usable loop',
            buildRoute: 'product-pipeline',
            confidence: 0.5,
            stage: 'complete',
            historyComplete: '2026-04-30T12:00:00Z',
        }));
        writeArtifact(root, '.omc/learning/2026-04-25-first.md', learningMarkdown('2026-04-25-first', 'Iterate on resume telemetry.'));
        writeArtifact(root, '.omc/cycles/2026-05-01-resume.md', completedCycleMarkdown({
            cycleId: '2026-05-01-resume',
            goal: 'resume telemetry',
            buildRoute: 'product-pipeline',
            confidence: 0.7,
            stage: 'complete',
            historyComplete: '2026-05-04T12:00:00Z',
        }));
        writeArtifact(root, '.omc/learning/2026-05-01-resume.md', learningMarkdown('2026-05-01-resume', 'Add streak surface.'));
        const report = generateHistoricalScorecard(root);
        expect(report.totals.cycles).toBe(2);
        expect(report.totals.completed).toBe(2);
        expect(report.cycles[0].cycle_id).toBe('2026-04-25-first');
        expect(report.cycles[1].cycle_id).toBe('2026-05-01-resume');
        expect(report.cycles[1].time_to_complete_days).toBe(3);
        expect(report.cycles[0].time_to_complete_days).toBe(5);
        expect(report.cycles.every((cycle) => cycle.has_learning_capture)).toBe(true);
        const confidenceTrend = report.trends.find((trend) => trend.metric === 'confidence');
        expect(confidenceTrend?.direction).toBe('improving');
        const ttcTrend = report.trends.find((trend) => trend.metric === 'time_to_complete_days');
        expect(ttcTrend?.direction).toBe('improving');
        expect(report.comparison.latest?.cycle_id).toBe('2026-05-01-resume');
        expect(report.comparison.previous?.cycle_id).toBe('2026-04-25-first');
        expect(report.comparison.improvements.some((entry) => entry.includes('time_to_complete'))).toBe(true);
        expect(report.comparison.improvements.some((entry) => entry.includes('confidence'))).toBe(true);
    });
    it('flags missing learning capture and infrastructure-heavy cycles', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/2026-05-08-streaks.md', incompleteCycleMarkdown('2026-05-08-streaks', 'streaks', 'backend-pipeline', 'verify'));
        const report = generateHistoricalScorecard(root);
        expect(report.totals.cycles).toBe(1);
        expect(report.totals.completed).toBe(0);
        expect(report.cycles[0].has_learning_capture).toBe(false);
        expect(report.cycles[0].user_visible_count).toBeLessThanOrEqual(report.cycles[0].infrastructure_count);
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-historical-'));
    rootsToClean.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function completedCycleMarkdown(options) {
    return `# Product Cycle: ${options.goal}

cycle_id: ${options.cycleId}
cycle_goal: ${options.goal}
cycle_stage: ${options.stage}
product_stage: pre-mvp

## Stage Checklist
- [x] discover
- [x] rank
- [x] select
- [x] spec
- [x] build
- [x] verify
- [x] learn

## Selected Cycle Portfolio
core_product_slice: reader/onboarding loop powered by ${options.goal}
enabling_task: backend persistence for the loop
learning_task: design partner ux session

## Cycle Spec
acceptance_criteria:
  - ship the loop
build_route: ${options.buildRoute}
verification_plan:
  - npm test
learning_plan:
  - observe a design partner

## History
- ${options.cycleId.slice(0, 10)}T10:00:00Z discover
- ${options.historyComplete} learn
- ${options.historyComplete} complete

status: ok
evidence:
  - fixture
confidence: ${options.confidence}
blocking_issues:
  - []
next_action: start next cycle
artifacts_written:
  - .omc/cycles/${options.cycleId}.md
`;
}
function incompleteCycleMarkdown(cycleId, goal, buildRoute, stage) {
    return `# Product Cycle: ${goal}

cycle_id: ${cycleId}
cycle_goal: ${goal}
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
core_product_slice: streaks api integration
enabling_task: queue worker schema migration
learning_task: backend uptime telemetry

## Cycle Spec
acceptance_criteria:
  - ship streaks
build_route: ${buildRoute}
verification_plan:
  - npm test
learning_plan:
  - watch backend uptime

status: needs-research
evidence:
  - fixture
confidence: 0.4
blocking_issues:
  - awaiting infra
next_action: continue
artifacts_written:
  - .omc/cycles/${cycleId}.md
`;
}
function learningMarkdown(cycleId, recommendation) {
    return `# Learning: ${cycleId}

cycle_id: ${cycleId}

## Shipped outcome
Cycle ${cycleId} shipped its first usable loop.

## Evidence collected
- two design partners completed the loop

## User/product learning
- resume-on-row was the key value

## Invalidated assumptions
- a chart editor is not needed in week 1

## Recommended next cycle
${recommendation}

status: ok
evidence:
  - fixture
confidence: 0.7
blocking_issues:
  - []
next_action: start next cycle
artifacts_written:
  - .omc/learning/${cycleId}.md
`;
}
//# sourceMappingURL=historical-scorecard.test.js.map
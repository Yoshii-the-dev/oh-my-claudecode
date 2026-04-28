import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductResearchArtifact } from '../research-artifact-validator.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('validateProductResearchArtifact', () => {
    it('rejects a thin pass verdict without research substance', () => {
        const root = createRoot();
        writeResearch(root, 'research_verdict: pass\nsources: fixture\n');
        const result = validateProductResearchArtifact({
            root,
            expectedRouteIds: ['user-interaction-research'],
        });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('missing-concrete-sources');
        expect(result.issues.map((issue) => issue.code)).toContain('missing-user-journey');
    });
    it('accepts a sourced user-facing research artifact with UX states and decision constraints', () => {
        const root = createRoot();
        writeResearch(root, validUserFacingResearchArtifact());
        const result = validateProductResearchArtifact({
            root,
            expectedCycleId: '2026-04-28-research',
            expectedCycleStage: 'build',
            expectedRouteIds: ['user-interaction-research'],
        });
        expect(result.ok).toBe(true);
        expect(result.verdict).toBe('pass');
        expect(result.metrics.sourceCount).toBeGreaterThan(0);
    });
    it('rejects a stale artifact from a different cycle', () => {
        const root = createRoot();
        writeResearch(root, validUserFacingResearchArtifact({ cycleId: '2026-04-01-old-cycle' }));
        const result = validateProductResearchArtifact({
            root,
            expectedCycleId: '2026-04-28-research',
            expectedCycleStage: 'build',
            expectedRouteIds: ['user-interaction-research'],
        });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('research-cycle-id-mismatch');
    });
    it('requires official documentation evidence for dependency research', () => {
        const root = createRoot();
        writeResearch(root, validUserFacingResearchArtifact().replace('official platform documentation', 'public notes'));
        const result = validateProductResearchArtifact({
            root,
            expectedRouteIds: ['dependency-api-research'],
        });
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.code)).toContain('missing-official-docs-evidence');
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-research-validator-'));
    rootsToClean.push(root);
    return root;
}
function writeResearch(root, content) {
    const path = join(root, '.omc/research/product-cycle/current.md');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function validUserFacingResearchArtifact(options = {}) {
    const cycleId = options.cycleId ?? '2026-04-28-research';
    const cycleStage = options.cycleStage ?? 'build';
    return `# Product Cycle Research

cycle_id: ${cycleId}
cycle_stage: ${cycleStage}
cycle_goal: ship researched row tracking
research_verdict: pass

## Sources
- official platform documentation for persistent local state behavior
- design partner observation notes from row-tracking onboarding

## Findings
Users need a visible current row, a clear saved state, and a low-friction continuation path.

## Applicability
Applies to the first usable loop for a focused row-tracking reader screen.

## Decision Constraints
Keep one primary action visible, avoid inactive controls in empty states, and preserve the current row during save failures.

## Risks
Save failure ambiguity can reduce trust if retry and recovery are not explicit.

## Open Questions
Whether design partners expect keyboard-first row marking in the first release.

## Pass Reason
The research is sufficient to choose the build shape because the core interaction states and constraints are explicit.

## User Journey
The user opens a pattern, marks the current row, sees saved progress, and returns to continue.

## Empty States
When no pattern is loaded, show one start action and no inactive row controls.

## Failure States
When saving fails, keep the row visible and offer retry without losing context.

## Loading States
Show progress restoration while the saved row is loading.

## Return Session
Resume at the next row with the previous completion state visible.

## Accessibility
Expose row state changes to assistive technology and keep keyboard focus predictable.

## Perceived Value
The value is confidence that the next session resumes exactly where the user stopped.
`;
}
//# sourceMappingURL=research-artifact-validator.test.js.map
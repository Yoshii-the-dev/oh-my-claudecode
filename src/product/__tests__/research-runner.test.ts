import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runProductResearchExecutionPlan, type ProductResearchCommandRunner } from '../research-runner.js';
import type { ProductResearchExecutionPlan } from '../research-execution-plan.js';

describe('runProductResearchExecutionPlan', () => {
  it('runs executable research prompt steps and skips manual steps', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-research-runner-'));
    const calls: string[][] = [];
    const commandRunner: ProductResearchCommandRunner = (argv) => {
      calls.push(argv);
      writeResearch(root, validUserFacingResearchArtifact());
      return { status: 0 };
    };

    const report = runProductResearchExecutionPlan(basePlan(), { root, commandRunner });

    expect(report.status).toBe('partial');
    expect(report.executed_step_count).toBe(1);
    expect(report.skipped_step_count).toBe(1);
    expect(report.research_artifact_valid).toBe(true);
    expect(calls).toEqual([
      ['omc', 'ask', 'codex', '--agent-prompt', 'ux-researcher', '--prompt', 'research UX patterns'],
    ]);
    expect(report.step_results.map((step) => step.status)).toEqual(['passed', 'skipped']);
  });

  it('fails the run when commands pass but the research artifact is missing or invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-research-runner-invalid-'));
    const commandRunner: ProductResearchCommandRunner = () => ({ status: 0 });

    const report = runProductResearchExecutionPlan(basePlan(), { root, commandRunner });

    expect(report.status).toBe('failed');
    expect(report.failed_step_count).toBe(0);
    expect(report.research_artifact_valid).toBe(false);
    expect(report.research_validation_issues.map((issue) => issue.code)).toContain('missing-research-artifact');
  });
});

function basePlan(): ProductResearchExecutionPlan {
  return {
    schema_version: 1,
    produced_at: '2026-04-28T00:00:00.000Z',
    agent_role: 'product-research-execution-planner',
    source_handoff: '.omc/handoffs/product-cycle-research/current.json',
    cycle_stage: 'build',
    cycle_id: '2026-04-28-research',
    cycle_goal: 'ship researched row tracking',
    provider: 'codex',
    research_artifact: '.omc/research/product-cycle/current.md',
    steps: [{
      route_id: 'user-interaction-research',
      agent: 'ux-researcher',
      source_command: '/prompts:ux-researcher "research UX patterns"',
      execution_surface: 'agent-prompt',
      executable: true,
      review_required: false,
      reason: 'Research prompt route',
      expected_artifact: '.omc/research/product-cycle/current.md',
      argv: ['omc', 'ask', 'codex', '--agent-prompt', 'ux-researcher', '--prompt', 'research UX patterns'],
    }, {
      route_id: 'manual-research',
      agent: 'researcher',
      source_command: '/manual-research',
      execution_surface: 'manual',
      executable: false,
      review_required: true,
      reason: 'Manual research',
      expected_artifact: '.omc/research/product-cycle/current.md',
    }],
    executable_step_count: 1,
    manual_step_count: 1,
    next_argv: ['omc', 'ask', 'codex', '--agent-prompt', 'ux-researcher', '--prompt', 'research UX patterns'],
  };
}

function writeResearch(root: string, content: string): void {
  const path = join(root, '.omc/research/product-cycle/current.md');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function validUserFacingResearchArtifact(): string {
  return `# Product Cycle Research

cycle_id: 2026-04-28-research
cycle_stage: build
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

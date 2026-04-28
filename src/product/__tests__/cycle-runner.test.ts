import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceProductCycle, readProductCycle } from '../cycle-fsm.js';
import { runProductCycle } from '../cycle-runner.js';

let rootsToClean: string[] = [];

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
    writeArtifact(root, '.omc/product/capability-map/current.md', discoveryCapabilityArtifact());
    writeArtifact(root, '.omc/ecosystem/current.md', discoveryEcosystemArtifact());

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
    expect(verifyResult?.interventions?.map((route) => route.agent)).toEqual([
      'debugger',
      'executor',
      'test-engineer',
      'verifier',
    ]);
    expect(report.interventionHandoff?.jsonPath).toContain('.omc/handoffs/product-cycle-interventions/current.json');
    expect(report.interventionHandoff?.jsonPath ? existsSync(report.interventionHandoff.jsonPath) : false).toBe(true);
    expect(report.interventionExecutionPlan?.jsonPath)
      .toContain('.omc/handoffs/product-cycle-interventions/execution-plan.json');
    expect(report.interventionExecutionPlan?.jsonPath
      ? existsSync(report.interventionExecutionPlan.jsonPath)
      : false).toBe(true);
    const handoff = JSON.parse(readFileSync(report.interventionHandoff!.jsonPath, 'utf-8')) as {
      routes: Array<{ agent: string; command: string }>;
      next_command: string;
    };
    expect(handoff.routes.map((route) => route.agent)).toEqual(['debugger', 'executor', 'test-engineer', 'verifier']);
    expect(handoff.next_command).toContain('/prompts:debugger');
  });

  it('routes visual user-facing builds through stack provisioning before product-pipeline', () => {
    const root = createRoot();
    setupCycleAt(root, 'build');
    writeArtifact(root, '.omc/research/product-cycle/current.md', validUserFacingResearchArtifact());
    writeArtifact(root, '.omc/experience/current.md', richExperienceGateArtifact());

    const report = runProductCycle({ root });

    expect(report.stoppedReason).toBe('pause-for-llm');
    const buildResult = report.stageResults.find((entry) => entry.stage === 'build');
    expect(buildResult?.instruction).toContain('stack-provision');
    expect(buildResult?.interventions?.map((route) => route.id)).toEqual([
      'visual-creative-skill-provisioning',
      'product-build-pipeline',
    ]);
    expect(report.interventionHandoff?.jsonPath ? existsSync(report.interventionHandoff.jsonPath) : false).toBe(true);
    expect(report.interventionExecutionPlan?.jsonPath
      ? existsSync(report.interventionExecutionPlan.jsonPath)
      : false).toBe(true);
    const handoff = JSON.parse(readFileSync(report.interventionHandoff!.jsonPath, 'utf-8')) as {
      routes: Array<{ id: string; command: string }>;
    };
    expect(handoff.routes[0]?.id).toBe('visual-creative-skill-provisioning');
    expect(handoff.routes[0]?.command).toContain('--surfaces=frontend-product,visual-creative');
  });

  it('blocks visual user-facing builds for research before implementation routing', () => {
    const root = createRoot();
    setupCycleAt(root, 'build');
    writeArtifact(root, '.omc/experience/current.md', `# Experience Gate

## User Journey
The dashboard screen has a visual row-tracking interface.

## UX Verdict
pass
`);

    const report = runProductCycle({ root });

    expect(report.stoppedReason).toBe('pause-for-llm');
    const buildResult = report.stageResults.find((entry) => entry.stage === 'build');
    expect(buildResult?.reason).toContain('research required');
    expect(buildResult?.research?.map((route) => route.id)).toEqual([
      'research-skill-provisioning',
      'user-interaction-research',
    ]);
    expect(buildResult?.instruction).toContain('/stack-provision');
    expect(report.researchHandoff?.jsonPath).toContain('.omc/handoffs/product-cycle-research/current.json');
    expect(report.researchHandoff?.jsonPath ? existsSync(report.researchHandoff.jsonPath) : false).toBe(true);
    expect(report.interventionHandoff).toBeUndefined();
  });

  it('does not request visual skill provisioning when the visual manifest is already present', () => {
    const root = createRoot();
    setupCycleAt(root, 'build');
    writeArtifact(root, '.omc/research/product-cycle/current.md', validUserFacingResearchArtifact());
    writeArtifact(root, '.omc/experience/current.md', richExperienceGateArtifact());
    writeArtifact(root, '.omc/provisioned/current.json', JSON.stringify({
      surfaces: ['visual-creative'],
      installed: ['meaning-driven-ui-builder', 'visual-verdict'],
    }));

    const report = runProductCycle({ root });

    const buildResult = report.stageResults.find((entry) => entry.stage === 'build');
    expect(buildResult?.instruction).toContain('product-pipeline');
    expect(buildResult?.interventions?.map((route) => route.id)).toEqual(['product-build-pipeline']);
  });

  it('blocks user-facing builds when the experience gate is too thin', () => {
    const root = createRoot();
    setupCycleAt(root, 'build');
    writeArtifact(root, '.omc/research/product-cycle/current.md', validUserFacingResearchArtifact());
    writeArtifact(root, '.omc/experience/current.md', 'UX Verdict\npass\n\nScreen flow uses visual QA.\n');

    const report = runProductCycle({ root });

    const buildResult = report.stageResults.find((entry) => entry.stage === 'build');
    expect(buildResult?.instruction).toContain('product-experience-gate');
    expect(buildResult?.interventions?.map((route) => route.id)).toEqual(['prebuild-experience-gate']);
    expect(buildResult?.interventions?.[0]?.trigger).toContain('real passing experience gate');
  });

  it('blocks user-facing builds when research artifact has only a thin pass verdict', () => {
    const root = createRoot();
    setupCycleAt(root, 'build');
    writeArtifact(root, '.omc/research/product-cycle/current.md', 'research_verdict: pass\nsources: fixture\n');
    writeArtifact(root, '.omc/experience/current.md', richExperienceGateArtifact());

    const report = runProductCycle({ root });

    expect(report.stoppedReason).toBe('pause-for-llm');
    const buildResult = report.stageResults.find((entry) => entry.stage === 'build');
    expect(buildResult?.research?.map((route) => route.id)).toEqual([
      'research-skill-provisioning',
      'user-interaction-research',
    ]);
    expect(buildResult?.research?.find((route) => route.id === 'user-interaction-research')?.trigger)
      .toContain('missing-concrete-sources');
    expect(report.interventionHandoff).toBeUndefined();
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

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-cycle-runner-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function setupCycleAt(root: string, stage: 'build' | 'verify' | 'select', cycleId = '2026-04-25-first'): void {
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

function writePortfolioLedger(root: string, cycleId: string, includes: { core: boolean; enabling: boolean; learning: boolean }): void {
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

function learningArtifact(): string {
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

function richExperienceGateArtifact(): string {
  return `# Experience Gate

## User Journey
The user opens the reader screen from the project dashboard, sees the current pattern row, selects the row state, and continues through the focused row-tracking flow without setup work.

## Empty States
When no pattern is loaded, the empty state explains that the first step is opening the sample pattern, shows one primary start action, and avoids presenting inactive controls.

## Failure States
If progress cannot be saved, the error state explains the failed save, keeps the current row visible, offers retry, and makes recovery safe before the user leaves.

## Return Session
When the user reopens the app, the return session resumes at the next row, shows the previous completion state, and lets the user continue without reselecting context.

## Perceived Value
The value is clear because the interface makes row progress easier to trust, reduces repeated setup, and gives confidence that the next session will resume correctly.

## UX Verdict
pass

status: ok
evidence: fixture
confidence: 0.8
blocking_issues: []
next_action: build
artifacts_written: .omc/experience/current.md
`;
}

function validUserFacingResearchArtifact(): string {
  return `# Product Cycle Research

cycle_id: 2026-04-25-first
cycle_stage: build
cycle_goal: ship loop
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

function discoveryCapabilityArtifact(): string {
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
Backend work is limited to persistence for the first loop.

run_id: test
agent_role: product-strategist
requested_next_agent: priority-engine
artifacts_produced:
  - .omc/product/capability-map/current.md
`;
}

function discoveryEcosystemArtifact(): string {
  return `# Ecosystem Map

## App Surfaces
Reader, library, progress dashboard.

## Content Loops
Sample patterns and walkthroughs.

## Data Loops
Progress events improve row tracking.

## Distribution Loops
Design partner invitations and creator walkthrough sharing.

## Integrations
Pattern import sources.

## Research Loop
Observe resume sessions.

## Deeper Version Paths
v0: first reader loop.
v1: shared pattern projects.
v2: creator tooling.
research gate: validate resume behavior with design partners.

run_id: test
agent_role: product-ecosystem-architect
requested_next_agent: priority-engine
artifacts_produced:
  - .omc/ecosystem/current.md
`;
}

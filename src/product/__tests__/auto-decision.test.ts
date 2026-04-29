import { describe, expect, it } from 'vitest';
import { decideAutoAction } from '../auto-decision.js';
import type { ProductInterventionExecutionPlan } from '../intervention-execution-plan.js';

describe('decideAutoAction', () => {
  it('runs when all steps are safe executable surfaces', () => {
    const decision = decideAutoAction({ policy: 'safe', plan: planWith([safeStep('repair')]) });

    expect(decision.action).toBe('run');
    expect(decision.reason).toBe('safe-executable');
  });

  it('blocks unsafe manual steps', () => {
    const decision = decideAutoAction({ policy: 'safe', plan: planWith([manualStep('manual')]) });

    expect(decision.action).toBe('block');
    expect(decision.reason).toBe('unsafe-step');
    expect(decision.blockedStepIds).toEqual(['manual']);
  });

  it('blocks missing dependency/provisioning routes', () => {
    const decision = decideAutoAction({
      policy: 'safe',
      plan: planWith([safeStep('repair')]),
      missingDependency: true,
    });

    expect(decision.action).toBe('block');
    expect(decision.reason).toBe('missing-dependency');
  });

  it('asks the user for human gates', () => {
    const decision = decideAutoAction({
      policy: 'safe',
      plan: planWith([safeStep('repair')]),
      humanGate: true,
    });

    expect(decision.action).toBe('ask_user');
    expect(decision.reason).toBe('human-gate');
  });

  it('blocks at max attempts and repeated failures', () => {
    expect(decideAutoAction({
      policy: 'safe',
      plan: planWith([safeStep('repair')]),
      attemptCount: 3,
      maxAttempts: 3,
    }).reason).toBe('max-attempts');

    expect(decideAutoAction({
      policy: 'safe',
      plan: planWith([safeStep('repair')]),
      repeatedFailure: true,
    }).reason).toBe('repeated-failure');
  });
});

function planWith(steps: ProductInterventionExecutionPlan['steps']): ProductInterventionExecutionPlan {
  return {
    schema_version: 1,
    produced_at: '2026-04-29T00:00:00.000Z',
    agent_role: 'product-intervention-execution-planner',
    source_handoff: '.omc/handoffs/product-cycle-interventions/current.json',
    cycle_stage: 'verify',
    provider: 'codex',
    steps,
    executable_step_count: steps.filter((step) => step.executable).length,
    review_required_step_count: 0,
    manual_step_count: steps.filter((step) => !step.executable).length,
  };
}

function safeStep(routeId: string): ProductInterventionExecutionPlan['steps'][number] {
  return {
    route_id: routeId,
    agent: 'debugger',
    source_command: '/prompts:debugger "fix"',
    execution_surface: 'agent-prompt',
    executable: true,
    review_required: false,
    reason: 'safe',
    argv: ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'fix'],
  };
}

function manualStep(routeId: string): ProductInterventionExecutionPlan['steps'][number] {
  return {
    route_id: routeId,
    agent: 'qa-tester',
    source_command: '/unknown',
    execution_surface: 'manual',
    executable: false,
    review_required: true,
    reason: 'manual',
  };
}

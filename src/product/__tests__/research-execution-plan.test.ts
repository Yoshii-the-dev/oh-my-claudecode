import { describe, expect, it } from 'vitest';
import { buildProductResearchExecutionPlan } from '../research-execution-plan.js';
import type { ProductResearchHandoff } from '../research-router.js';

describe('buildProductResearchExecutionPlan', () => {
  it('plans stack-provision research routes through safe stack plan execution', () => {
    const plan = buildProductResearchExecutionPlan({
      schema_version: 1,
      produced_at: '2026-04-28T00:00:00.000Z',
      agent_role: 'product-research-router',
      cycle_stage: 'build',
      status: 'blocked',
      routes: [{
        id: 'research-skill-provisioning',
        agent: 'stack-provision',
        trigger: 'missing research skill coverage',
        purpose: 'Provision research skills',
        required: true,
        command: '/stack-provision --surfaces=frontend-product,visual-creative --creative-intent="row tracking"',
        blocksStage: true,
        evidence: ['.omc/provisioned/current.json'],
        expectedArtifact: '.omc/research/product-cycle/current.md',
      }],
      blocking_route_count: 1,
      research_artifact: '.omc/research/product-cycle/current.md',
      context_consumed: ['.omc/cycles/current.md'],
    } satisfies ProductResearchHandoff);

    expect(plan.executable_step_count).toBe(1);
    expect(plan.steps[0]?.execution_surface).toBe('stack-plan');
    expect(plan.steps[0]?.review_required).toBe(true);
    expect(plan.steps[0]?.argv).toEqual([
      'omc',
      'stack',
      'plan',
      '--surfaces=frontend-product,visual-creative',
      '--creative-intent=row tracking',
    ]);
  });
});

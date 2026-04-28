import { describe, expect, it } from 'vitest';
import { runProductInterventionExecutionPlan, type ProductInterventionCommandRunner } from '../intervention-runner.js';
import type { ProductInterventionExecutionPlan } from '../intervention-execution-plan.js';

describe('runProductInterventionExecutionPlan', () => {
  it('runs safe executable steps and skips unknown manual slash skills', () => {
    const calls: string[][] = [];
    const commandRunner: ProductInterventionCommandRunner = (argv) => {
      calls.push(argv);
      return { status: 0 };
    };

    const report = runProductInterventionExecutionPlan(basePlan(), { commandRunner });

    expect(report.status).toBe('partial');
    expect(report.executed_step_count).toBe(3);
    expect(report.skipped_step_count).toBe(1);
    expect(calls).toEqual([
      ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root cause'],
      ['omc', 'stack', 'plan', '--surfaces=visual-creative'],
      ['omc', 'team', 'start', '--agent', 'codex', '--count', '2', '--subject', 'product-pipeline', '--task', 'build product'],
    ]);
    expect(report.step_results.map((step) => step.status)).toEqual(['passed', 'passed', 'passed', 'skipped']);
  });

  it('stops after the first failed executable step', () => {
    const calls: string[][] = [];
    const commandRunner: ProductInterventionCommandRunner = (argv) => {
      calls.push(argv);
      return { status: calls.length === 1 ? 1 : 0 };
    };

    const report = runProductInterventionExecutionPlan(basePlan(), { commandRunner });

    expect(report.status).toBe('failed');
    expect(report.failed_step_count).toBe(1);
    expect(calls).toEqual([
      ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root cause'],
    ]);
    expect(report.step_results.map((step) => step.status)).toEqual(['failed']);
  });

  it('waits for team-start jobs when requested', () => {
    const calls: string[][] = [];
    const commandRunner: ProductInterventionCommandRunner = (argv) => {
      calls.push(argv);
      if (argv[2] === 'start') {
        return { status: 0, stdout: JSON.stringify({ jobId: 'omc-team123', status: 'running' }) };
      }
      if (argv[2] === 'wait') {
        return { status: 0, stdout: JSON.stringify({ jobId: 'omc-team123', status: 'completed' }) };
      }
      return { status: 0 };
    };

    const report = runProductInterventionExecutionPlan(teamOnlyPlan(), {
      commandRunner,
      waitForTeamJobs: true,
      teamWaitTimeoutMs: 5000,
    });

    expect(report.status).toBe('passed');
    expect(calls).toEqual([
      ['omc', 'team', 'start', '--agent', 'codex', '--count', '2', '--subject', 'product-pipeline', '--task', 'build product', '--json'],
      ['omc', 'team', 'wait', 'omc-team123', '--json', '--timeout-ms', '5000'],
    ]);
    expect(report.step_results[0]?.child_job_id).toBe('omc-team123');
    expect(report.step_results[0]?.child_job_status).toBe('completed');
  });

  it('fails waited team-start steps when the team job times out', () => {
    const commandRunner: ProductInterventionCommandRunner = (argv) => {
      if (argv[2] === 'start') {
        return { status: 0, stdout: JSON.stringify({ jobId: 'omc-team123', status: 'running' }) };
      }
      return { status: 0, stdout: JSON.stringify({ jobId: 'omc-team123', status: 'running', timedOut: true }) };
    };

    const report = runProductInterventionExecutionPlan(teamOnlyPlan(), {
      commandRunner,
      waitForTeamJobs: true,
    });

    expect(report.status).toBe('failed');
    expect(report.failed_step_count).toBe(1);
    expect(report.step_results[0]?.reason).toContain('timed out');
  });
});

function basePlan(): ProductInterventionExecutionPlan {
  return {
    schema_version: 1,
    produced_at: '2026-04-28T00:00:00.000Z',
    agent_role: 'product-intervention-execution-planner',
    source_handoff: '.omc/handoffs/product-cycle-interventions/current.json',
    cycle_stage: 'verify',
    provider: 'codex',
    steps: [{
      route_id: 'verify-root-cause',
      agent: 'debugger',
      source_command: '/prompts:debugger "root cause"',
      execution_surface: 'agent-prompt',
      executable: true,
      review_required: false,
      reason: 'Prompt route',
      argv: ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root cause'],
    }, {
      route_id: 'visual-plan',
      agent: 'stack-provision',
      source_command: '/stack-provision --surfaces=visual-creative',
      execution_surface: 'stack-plan',
      executable: true,
      review_required: true,
      reason: 'Plan only',
      argv: ['omc', 'stack', 'plan', '--surfaces=visual-creative'],
    }, {
      route_id: 'product-build-pipeline',
      agent: 'product-pipeline',
      source_command: '/product-pipeline "<core product slice>"',
      execution_surface: 'team-start',
      executable: true,
      review_required: true,
      reason: 'Team adapter',
      argv: ['omc', 'team', 'start', '--agent', 'codex', '--count', '2', '--subject', 'product-pipeline', '--task', 'build product'],
    }, {
      route_id: 'unknown-route',
      agent: 'qa-tester',
      source_command: '/unknown-skill "<core product slice>"',
      execution_surface: 'slash-skill',
      executable: false,
      review_required: true,
      reason: 'Interactive slash skill',
    }],
    executable_step_count: 3,
    review_required_step_count: 3,
    manual_step_count: 1,
    next_argv: ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root cause'],
  };
}

function teamOnlyPlan(): ProductInterventionExecutionPlan {
  return {
    schema_version: 1,
    produced_at: '2026-04-28T00:00:00.000Z',
    agent_role: 'product-intervention-execution-planner',
    source_handoff: '.omc/handoffs/product-cycle-interventions/current.json',
    cycle_stage: 'build',
    provider: 'codex',
    steps: [{
      route_id: 'product-build-pipeline',
      agent: 'product-pipeline',
      source_command: '/product-pipeline "<core product slice>"',
      execution_surface: 'team-start',
      executable: true,
      review_required: true,
      reason: 'Team adapter',
      argv: ['omc', 'team', 'start', '--agent', 'codex', '--count', '2', '--subject', 'product-pipeline', '--task', 'build product'],
    }],
    executable_step_count: 1,
    review_required_step_count: 1,
    manual_step_count: 0,
    next_argv: ['omc', 'team', 'start', '--agent', 'codex', '--count', '2', '--subject', 'product-pipeline', '--task', 'build product'],
  };
}

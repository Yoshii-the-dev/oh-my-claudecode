import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('product cycle CLI command', () => {
  it('returns usage error for invalid advance target', async () => {
    const logger = {
      log: vi.fn(),
      error: vi.fn(),
    };
    const { productCycleAdvanceCommand } = await import('../commands/product-cycle.js');

    const exitCode = await productCycleAdvanceCommand(undefined, { to: 'invalid' }, logger);

    expect(exitCode).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid or missing target stage'));
  });

  it('is registered as a top-level command with runtime FSM subcommands', async () => {
    process.env.OMC_CLI_SKIP_PARSE = '1';
    const { buildProgram } = await import('../index.js');

    const productCycleCmd = buildProgram().commands.find((command) => command.name() === 'product-cycle');
    expect(productCycleCmd).toBeDefined();
    expect(productCycleCmd?.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      'status',
      'next',
      'validate',
      'advance',
      'interventions',
      'interventions-plan',
      'interventions-run',
      'research',
      'research-plan',
      'research-run',
    ]));
  });

  it('prints pending intervention handoff as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-cli-'));
    try {
      const handoffPath = join(root, '.omc/handoffs/product-cycle-interventions/current.json');
      mkdirSync(join(handoffPath, '..'), { recursive: true });
      writeFileSync(handoffPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-intervention-router',
        cycle_stage: 'build',
        status: 'blocked',
        next_command: '/stack-provision --surfaces=frontend-product,visual-creative',
        routes: [{
          id: 'visual-creative-skill-provisioning',
          agent: 'stack-provision',
          trigger: 'visual coverage missing',
          purpose: 'Provision visual skills',
          required: true,
          command: '/stack-provision --surfaces=frontend-product,visual-creative',
          blocksStage: true,
        }],
        blocking_route_count: 1,
        context_consumed: ['.omc/cycles/current.md'],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleInterventionsCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleInterventionsCommand(root, { json: true }, logger);

      expect(exitCode).toBe(1);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('visual-creative-skill-provisioning'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes an executable plan for pending interventions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-plan-cli-'));
    try {
      const handoffPath = join(root, '.omc/handoffs/product-cycle-interventions/current.json');
      mkdirSync(join(handoffPath, '..'), { recursive: true });
      writeFileSync(handoffPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-intervention-router',
        cycle_stage: 'verify',
        status: 'blocked',
        next_command: '/prompts:debugger "root-cause failure"',
        routes: [{
          id: 'verify-root-cause',
          agent: 'debugger',
          trigger: 'verify failed',
          purpose: 'Find root cause',
          required: true,
          command: '/prompts:debugger "root-cause failure"',
          blocksStage: true,
        }, {
          id: 'visual-creative-skill-provisioning',
          agent: 'stack-provision',
          trigger: 'visual coverage missing',
          purpose: 'Provision visual skills',
          required: true,
          command: '/stack-provision --surfaces=frontend-product,visual-creative --creative-intent="calm dashboard"',
          blocksStage: true,
        }],
        blocking_route_count: 2,
        context_consumed: [],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleInterventionsPlanCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleInterventionsPlanCommand(root, { json: true, provider: 'codex' }, logger);

      expect(exitCode).toBe(0);
      const planPath = join(root, '.omc/handoffs/product-cycle-interventions/execution-plan.json');
      expect(existsSync(planPath)).toBe(true);
      const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as {
        executable_step_count: number;
        steps: Array<{ execution_surface: string; argv: string[] }>;
      };
      expect(plan.executable_step_count).toBe(2);
      expect(plan.steps[0]?.execution_surface).toBe('agent-prompt');
      expect(plan.steps[0]?.argv).toEqual([
        'omc',
        'ask',
        'codex',
        '--agent-prompt',
        'debugger',
        '--prompt',
        'root-cause failure',
      ]);
      expect(plan.steps[1]?.execution_surface).toBe('stack-plan');
      expect(plan.steps[1]?.argv).toEqual([
        'omc',
        'stack',
        'plan',
        '--surfaces=frontend-product,visual-creative',
        '--creative-intent=calm dashboard',
      ]);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('execution-plan.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('dry-runs safe executable intervention steps and skips unknown manual slash skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-run-cli-'));
    try {
      const planPath = join(root, '.omc/handoffs/product-cycle-interventions/execution-plan.json');
      mkdirSync(join(planPath, '..'), { recursive: true });
      writeFileSync(planPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-intervention-execution-planner',
        source_handoff: '.omc/handoffs/product-cycle-interventions/current.json',
        cycle_stage: 'build',
        provider: 'codex',
        steps: [{
          route_id: 'verify-root-cause',
          agent: 'debugger',
          source_command: '/prompts:debugger "root-cause failure"',
          execution_surface: 'agent-prompt',
          executable: true,
          review_required: false,
          reason: 'Prompt route',
          argv: ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root-cause failure'],
        }, {
          route_id: 'unknown-route',
          agent: 'qa-tester',
          source_command: '/unknown-skill "<core product slice>"',
          execution_surface: 'slash-skill',
          executable: false,
          review_required: true,
          reason: 'Interactive slash skill',
        }],
        executable_step_count: 1,
        review_required_step_count: 1,
        manual_step_count: 1,
        next_argv: ['omc', 'ask', 'codex', '--agent-prompt', 'debugger', '--prompt', 'root-cause failure'],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleInterventionsRunCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleInterventionsRunCommand(root, { json: true, dryRun: true }, logger);

      expect(exitCode).toBe(0);
      expect(existsSync(join(root, '.omc/handoffs/product-cycle-interventions/run-report.json'))).toBe(false);
      const output = String(logger.log.mock.calls[0]?.[0] ?? '');
      expect(output).toContain('"status": "dry-run"');
      expect(output).toContain('"status": "skipped"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps product pipeline interventions to team-start execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-team-cli-'));
    try {
      const handoffPath = join(root, '.omc/handoffs/product-cycle-interventions/current.json');
      mkdirSync(join(handoffPath, '..'), { recursive: true });
      writeFileSync(handoffPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-intervention-router',
        cycle_stage: 'build',
        status: 'blocked',
        next_command: '/product-pipeline "<core product slice>"',
        routes: [{
          id: 'product-build-pipeline',
          agent: 'product-pipeline',
          trigger: 'build_route=product-pipeline',
          purpose: 'Build the core product slice through UX, designer/executor, quality, and verifier gates.',
          required: true,
          command: '/product-pipeline "<core product slice>"',
          blocksStage: true,
        }],
        blocking_route_count: 1,
        context_consumed: [],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleInterventionsPlanCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleInterventionsPlanCommand(root, { json: true, provider: 'codex' }, logger);

      expect(exitCode).toBe(0);
      const planPath = join(root, '.omc/handoffs/product-cycle-interventions/execution-plan.json');
      const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as {
        manual_step_count: number;
        steps: Array<{ execution_surface: string; executable: boolean; argv: string[] }>;
      };
      expect(plan.manual_step_count).toBe(0);
      expect(plan.steps[0]?.execution_surface).toBe('team-start');
      expect(plan.steps[0]?.executable).toBe(true);
      expect(plan.steps[0]?.argv.slice(0, 8)).toEqual([
        'omc',
        'team',
        'start',
        '--agent',
        'codex',
        '--count',
        '2',
        '--subject',
      ]);
      expect(plan.steps[0]?.argv.join('\n')).toContain('Run product-pipeline');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints pending research handoff as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-research-cli-'));
    try {
      const handoffPath = join(root, '.omc/handoffs/product-cycle-research/current.json');
      mkdirSync(join(handoffPath, '..'), { recursive: true });
      writeFileSync(handoffPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-research-router',
        cycle_stage: 'build',
        status: 'blocked',
        next_command: '/prompts:ux-researcher "research UX patterns"',
        routes: [{
          id: 'user-interaction-research',
          agent: 'ux-researcher',
          trigger: 'visual signals missing research',
          purpose: 'Research UX patterns',
          required: true,
          command: '/prompts:ux-researcher "research UX patterns"',
          blocksStage: true,
          evidence: ['.omc/cycles/current.md'],
          expectedArtifact: '.omc/research/product-cycle/current.md',
        }],
        blocking_route_count: 1,
        research_artifact: '.omc/research/product-cycle/current.md',
        context_consumed: ['.omc/cycles/current.md'],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleResearchCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleResearchCommand(root, { json: true }, logger);

      expect(exitCode).toBe(1);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('user-interaction-research'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes an executable plan for pending research', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-research-plan-cli-'));
    try {
      const handoffPath = join(root, '.omc/handoffs/product-cycle-research/current.json');
      mkdirSync(join(handoffPath, '..'), { recursive: true });
      writeFileSync(handoffPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-research-router',
        cycle_stage: 'build',
        status: 'blocked',
        next_command: '/prompts:ux-researcher "research UX patterns"',
        routes: [{
          id: 'user-interaction-research',
          agent: 'ux-researcher',
          trigger: 'visual signals missing research',
          purpose: 'Research UX patterns',
          required: true,
          command: '/prompts:ux-researcher "research UX patterns"',
          blocksStage: true,
          evidence: ['.omc/cycles/current.md'],
          expectedArtifact: '.omc/research/product-cycle/current.md',
        }],
        blocking_route_count: 1,
        research_artifact: '.omc/research/product-cycle/current.md',
        context_consumed: ['.omc/cycles/current.md'],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleResearchPlanCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleResearchPlanCommand(root, { json: true, provider: 'codex' }, logger);

      expect(exitCode).toBe(0);
      const planPath = join(root, '.omc/handoffs/product-cycle-research/execution-plan.json');
      expect(existsSync(planPath)).toBe(true);
      const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as {
        executable_step_count: number;
        research_artifact: string;
        steps: Array<{ execution_surface: string; argv: string[] }>;
      };
      expect(plan.research_artifact).toBe('.omc/research/product-cycle/current.md');
      expect(plan.executable_step_count).toBe(1);
      expect(plan.steps[0]?.execution_surface).toBe('agent-prompt');
      expect(plan.steps[0]?.argv).toEqual([
        'omc',
        'ask',
        'codex',
        '--agent-prompt',
        'ux-researcher',
        '--prompt',
        'research UX patterns',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('dry-runs pending research execution steps without writing a run report', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-research-run-cli-'));
    try {
      const planPath = join(root, '.omc/handoffs/product-cycle-research/execution-plan.json');
      mkdirSync(join(planPath, '..'), { recursive: true });
      writeFileSync(planPath, JSON.stringify({
        schema_version: 1,
        produced_at: '2026-04-28T00:00:00.000Z',
        agent_role: 'product-research-execution-planner',
        source_handoff: '.omc/handoffs/product-cycle-research/current.json',
        cycle_stage: 'build',
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
        }],
        executable_step_count: 1,
        manual_step_count: 0,
        next_argv: ['omc', 'ask', 'codex', '--agent-prompt', 'ux-researcher', '--prompt', 'research UX patterns'],
      }, null, 2));

      const logger = {
        log: vi.fn(),
        error: vi.fn(),
      };
      const { productCycleResearchRunCommand } = await import('../commands/product-cycle.js');

      const exitCode = await productCycleResearchRunCommand(root, { json: true, dryRun: true }, logger);

      expect(exitCode).toBe(0);
      expect(existsSync(join(root, '.omc/handoffs/product-cycle-research/run-report.json'))).toBe(false);
      const output = String(logger.log.mock.calls[0]?.[0] ?? '');
      expect(output).toContain('"status": "dry-run"');
      expect(output).toContain('"research_artifact": ".omc/research/product-cycle/current.md"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

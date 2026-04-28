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
        }
        finally {
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
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
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
        }
        finally {
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
        }
        finally {
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
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
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
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('auto-runs eligible build pipeline team jobs and resumes the cycle', async () => {
        const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-auto-build-cli-'));
        try {
            writeBuildCycle(root);
            writeBackendResearch(root);
            const commandRunner = vi.fn((argv) => {
                if (argv.slice(0, 4).join(' ') === 'omc team start --agent') {
                    expect(argv).toContain('--json');
                    return { status: 0, stdout: JSON.stringify({ jobId: 'team-job-1' }), stderr: '' };
                }
                if (argv.slice(0, 3).join(' ') === 'omc team wait') {
                    expect(argv).toEqual(['omc', 'team', 'wait', 'team-job-1', '--json']);
                    return { status: 0, stdout: JSON.stringify({ status: 'completed' }), stderr: '' };
                }
                return { status: 1, stdout: '', stderr: `unexpected command: ${argv.join(' ')}` };
            });
            const logger = {
                log: vi.fn(),
                error: vi.fn(),
            };
            const { productCycleRunCommand } = await import('../commands/product-cycle.js');
            const exitCode = await productCycleRunCommand(root, {
                json: true,
                verifyCommand: 'true',
                interventionCommandRunner: commandRunner,
            }, logger);
            expect(exitCode).toBe(0);
            expect(commandRunner).toHaveBeenCalledTimes(2);
            expect(existsSync(join(root, '.omc/handoffs/product-cycle-interventions/run-report.json'))).toBe(true);
            const output = JSON.parse(String(logger.log.mock.calls[0]?.[0] ?? '{}'));
            expect(output.autoBuild?.status).toBe('passed');
            expect(output.autoBuild?.runReport?.status).toBe('passed');
            expect(output.autoBuild?.resumedCycleReport?.stoppedReason).toBe('pause-for-llm');
            expect(output.autoBuild?.resumedCycleReport?.endedAtStage).toBe('learn');
            const telemetryPath = join(root, '.omc/telemetry/events/product-cycle-events.jsonl');
            expect(existsSync(telemetryPath)).toBe(true);
            const telemetry = readFileSync(telemetryPath, 'utf-8');
            expect(telemetry).toContain('"event":"build_intervention_planned"');
            expect(telemetry).toContain('"event":"build_team_completed"');
            expect(telemetry).toContain('"event":"build_auto_completed"');
            expect(telemetry).toContain('"event":"auto_resume"');
        }
        finally {
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
        }
        finally {
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
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
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
        }
        finally {
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
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('resumes product-cycle run after research-run finds a valid artifact', async () => {
        const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-research-resume-cli-'));
        try {
            writeArtifact(root, '.omc/cycles/current.md', cycleAtBuildArtifact());
            writeArtifact(root, '.omc/experience/current.md', richExperienceGateArtifact());
            writeArtifact(root, '.omc/provisioned/current.json', JSON.stringify({
                surfaces: ['visual-creative'],
                installed: ['meaning-driven-ui-builder', 'visual-verdict'],
            }));
            writeArtifact(root, '.omc/research/product-cycle/current.md', validUserFacingResearchArtifact());
            writeArtifact(root, '.omc/handoffs/product-cycle-research/execution-plan.json', JSON.stringify({
                schema_version: 1,
                produced_at: '2026-04-28T00:00:00.000Z',
                agent_role: 'product-research-execution-planner',
                source_handoff: '.omc/handoffs/product-cycle-research/current.json',
                cycle_stage: 'build',
                provider: 'codex',
                research_artifact: '.omc/research/product-cycle/current.md',
                steps: [],
                executable_step_count: 0,
                manual_step_count: 0,
            }, null, 2));
            const logger = {
                log: vi.fn(),
                error: vi.fn(),
            };
            const { productCycleResearchRunCommand } = await import('../commands/product-cycle.js');
            const exitCode = await productCycleResearchRunCommand(root, { json: true }, logger);
            expect(exitCode).toBe(0);
            const output = JSON.parse(String(logger.log.mock.calls[0]?.[0] ?? '{}'));
            expect(output.report.research_artifact_valid).toBe(true);
            expect(output.resumedCycleReport?.stoppedReason).toBe('pause-for-llm');
            expect(output.resumedCycleReport?.pauseInstruction).toContain('/product-pipeline');
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function writeBuildCycle(root) {
    writeArtifact(root, '.omc/cycles/current.md', `# Product Cycle: ship backend auth api

cycle_id: 2026-04-28-auto-build
cycle_stage: build
cycle_goal: ship backend auth api
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
core_product_slice: authenticated account settings
enabling_task: backend auth api and permission checks
learning_task: audit auth completion telemetry

## Cycle Spec
acceptance_criteria:
  - backend api validates authenticated settings updates
build_route: backend-pipeline
verification_plan:
  - true
learning_plan:
  - compare successful and rejected auth update attempts
`);
}
function writeBackendResearch(root) {
    writeArtifact(root, '.omc/research/product-cycle/current.md', `# Product Cycle Research

cycle_id: 2026-04-28-auto-build
cycle_stage: build
cycle_goal: ship backend auth api
research_verdict: pass

## Sources
- Express security best practices documentation
- OWASP API authorization guidance

## Findings
The backend api needs explicit permission checks, stable error handling, and clear audit events for rejected updates.

## Applicability
Applies to the backend auth api and permission boundary for account settings updates.

## Decision Constraints
Keep authorization checks server-side, validate request schema, and preserve audit evidence for denied updates.

## Risks
Authorization drift can expose account settings if route handlers bypass shared permission checks.

## Open Questions
Whether settings updates need per-field authorization in the first release.

## Pass Reason
The research is sufficient because architecture, api boundary, security, and schema constraints are explicit.
`);
}
function cycleAtBuildArtifact() {
    return `# Product Cycle: ship loop

cycle_id: 2026-04-28-research-resume
cycle_stage: build
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
`;
}
function richExperienceGateArtifact() {
    return `# Experience Gate

## User Journey
The user opens the reader screen from the dashboard, sees the current row, selects row state, and continues without setup work.

## Empty States
When no pattern is loaded, the empty state explains the first action and avoids inactive controls.

## Failure States
If progress cannot be saved, the error keeps the current row visible and offers retry.

## Return Session
When the user reopens the app, the return session resumes at the next row with previous completion visible.

## Perceived Value
The interface makes row progress easier to trust and reduces repeated setup.

## UX Verdict
pass
`;
}
function validUserFacingResearchArtifact() {
    return `# Product Cycle Research

cycle_id: 2026-04-28-research-resume
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
//# sourceMappingURL=product-cycle.test.js.map
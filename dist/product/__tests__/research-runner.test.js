import { describe, expect, it } from 'vitest';
import { runProductResearchExecutionPlan } from '../research-runner.js';
describe('runProductResearchExecutionPlan', () => {
    it('runs executable research prompt steps and skips manual steps', () => {
        const calls = [];
        const commandRunner = (argv) => {
            calls.push(argv);
            return { status: 0 };
        };
        const report = runProductResearchExecutionPlan(basePlan(), { commandRunner });
        expect(report.status).toBe('partial');
        expect(report.executed_step_count).toBe(1);
        expect(report.skipped_step_count).toBe(1);
        expect(calls).toEqual([
            ['omc', 'ask', 'codex', '--agent-prompt', 'ux-researcher', '--prompt', 'research UX patterns'],
        ]);
        expect(report.step_results.map((step) => step.status)).toEqual(['passed', 'skipped']);
    });
});
function basePlan() {
    return {
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
//# sourceMappingURL=research-runner.test.js.map
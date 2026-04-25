import { describe, expect, it, vi } from 'vitest';
describe('runScorecardCommand', () => {
    it('renders a report without throwing', async () => {
        const logger = { log: vi.fn() };
        const { runScorecardCommand } = await import('../commands/run-scorecard.js');
        const report = await runScorecardCommand(undefined, {}, logger);
        expect(report.root).toBe(process.cwd());
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Run scorecard'));
    });
    it('is registered as a top-level CLI command', async () => {
        process.env.OMC_CLI_SKIP_PARSE = '1';
        const { buildProgram } = await import('../index.js');
        const command = buildProgram().commands.find((entry) => entry.name() === 'run-scorecard');
        expect(command).toBeDefined();
        expect(command?.options.find((option) => option.long === '--json')).toBeDefined();
    });
});
//# sourceMappingURL=run-scorecard.test.js.map
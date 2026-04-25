import { describe, expect, it, vi } from 'vitest';
describe('productContractsCommand', () => {
    it('returns usage error for an unknown stage', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const { productContractsCommand } = await import('../commands/product-contracts.js');
            const exitCode = await productContractsCommand(undefined, { stage: 'not-a-stage' });
            expect(exitCode).toBe(2);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid product contract stage'));
        }
        finally {
            errorSpy.mockRestore();
        }
    });
    it('is registered under the doctor command', async () => {
        process.env.OMC_CLI_SKIP_PARSE = '1';
        const { buildProgram } = await import('../index.js');
        const prog = buildProgram();
        const doctorCmd = prog.commands.find((command) => command.name() === 'doctor');
        const productContractsCmd = doctorCmd?.commands.find((command) => command.name() === 'product-contracts');
        const productArtifactsCmd = doctorCmd?.commands.find((command) => command.name() === 'product-artifacts');
        expect(productContractsCmd).toBeDefined();
        expect(productContractsCmd?.options.find((option) => option.long === '--stage')).toBeDefined();
        expect(productContractsCmd?.options.find((option) => option.long === '--json')).toBeDefined();
        expect(productArtifactsCmd).toBeDefined();
        expect(productArtifactsCmd?.options.find((option) => option.long === '--json')).toBeDefined();
    });
});
//# sourceMappingURL=product-contracts.test.js.map
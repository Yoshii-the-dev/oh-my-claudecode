import { describe, expect, it, vi } from 'vitest';

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
    ]));
  });
});

/**
 * `omc telemetry digest` — generate a daily telemetry digest on demand.
 *
 * Runs aggregate({ trigger: 'on-demand', directory }) and prints the digest path.
 * Digest is written to .omc/telemetry/digests/daily/<YYYY-MM-DD>.md.
 */

import chalk from 'chalk';
import { resolve } from 'path';
import { aggregate } from '../../telemetry/aggregator.js';

export interface TelemetryDigestOptions {
  /** Project root directory. Defaults to process.cwd(). */
  directory?: string;
}

/**
 * Run the telemetry digest aggregator on demand.
 * Prints the resulting digest path to stdout.
 */
export async function telemetryDigestCommand(options: TelemetryDigestOptions = {}): Promise<void> {
  const directory = options.directory
    ? resolve(options.directory)
    : process.cwd();

  try {
    const { digestPath } = await aggregate({ trigger: 'on-demand', directory });
    console.log(chalk.green(`Telemetry digest written to:`));
    console.log(digestPath);
  } catch (err) {
    console.error(chalk.red('Failed to generate telemetry digest:'), err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

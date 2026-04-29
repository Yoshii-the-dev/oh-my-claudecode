import { colors } from '../utils/formatting.js';
import {
  renderRuntimeQaRunReport,
  runRuntimeQa,
  writeRuntimeQaRunReport,
  type RuntimeQaCommandRunner,
} from '../../runtime-qa/runner.js';
import { loadConfig } from '../../config/loader.js';
import { limitFinalReport } from '../../lib/summary-policy.js';

export interface RuntimeQaCommandOptions {
  auto?: boolean;
  dryRun?: boolean;
  json?: boolean;
  installMobileTools?: boolean;
  commandRunner?: RuntimeQaCommandRunner;
}

interface LoggerLike {
  log: (message?: unknown) => void;
  error: (message?: unknown) => void;
}

export async function runtimeQaRunCommand(
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const config = loadConfig();
  const report = runRuntimeQa({
    root,
    auto: options.auto,
    dryRun: options.dryRun,
    commandRunner: options.commandRunner,
    installMobileTools: options.installMobileTools,
    summaryPolicy: config.summaryPolicy,
  });
  const written = options.dryRun ? undefined : writeRuntimeQaRunReport(root ?? process.cwd(), report);

  if (options.json) {
    logger.log(JSON.stringify({ report, written: written ?? null }, null, 2));
  } else {
    const rendered = renderRuntimeQaRunReport(report);
    logger.log(limitFinalReport(rendered, config.summaryPolicy));
    if (written) {
      logger.log(colors.bold('Runtime QA report written:'));
      logger.log(`  ${written.jsonPath}`);
      logger.log(`  ${written.mdPath}`);
    }
  }

  return report.status === 'failed' || report.status === 'blocked' ? 1 : 0;
}

import { colors } from '../utils/formatting.js';
import { initRuntimeQaConfig, renderRuntimeQaRunReport, runRuntimeQa, writeRuntimeQaRunReport, } from '../../runtime-qa/runner.js';
import { loadConfig } from '../../config/loader.js';
import { limitFinalReport } from '../../lib/summary-policy.js';
export async function runtimeQaRunCommand(root, options, logger = console) {
    const config = loadConfig();
    const report = runRuntimeQa({
        root,
        auto: options.auto,
        dryRun: options.dryRun,
        commandRunner: options.commandRunner,
        installMobileTools: options.installMobileTools,
        writeDetectedConfig: options.auto === true,
        summaryPolicy: config.summaryPolicy,
    });
    const written = options.dryRun ? undefined : writeRuntimeQaRunReport(root ?? process.cwd(), report);
    if (options.json) {
        logger.log(JSON.stringify({ report, written: written ?? null }, null, 2));
    }
    else {
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
export async function runtimeQaInitCommand(root, options, logger = console) {
    const target = normalizeTarget(options.target);
    if (options.target && !target) {
        logger.error(colors.red(`Invalid --target: ${options.target}`));
        logger.error(colors.gray('Valid targets: web, cli, service, mobile, project-script'));
        return 2;
    }
    const result = initRuntimeQaConfig({
        root,
        target,
        write: options.write !== false,
        force: options.force === true,
    });
    if (options.json) {
        logger.log(JSON.stringify(result, null, 2));
    }
    else {
        logger.log(colors.bold('Runtime QA config'));
        logger.log(`  path: ${result.path}`);
        logger.log(`  target: ${result.config.target ?? 'project-script'}`);
        logger.log(`  adapter: ${result.config.adapter ?? 'project-script'}`);
        logger.log(`  written: ${result.written}`);
        logger.log(`  reason: ${result.reason}`);
        if (!result.config.commands?.smoke && result.config.target === 'mobile') {
            logger.log(colors.yellow('  mobile smoke command was not detected; set commands.smoke or mobile.command before verify can pass.'));
        }
    }
    return result.config.target === 'mobile' && !result.config.commands?.smoke ? 1 : 0;
}
function normalizeTarget(value) {
    if (!value)
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'web'
        || normalized === 'cli'
        || normalized === 'service'
        || normalized === 'mobile'
        || normalized === 'project-script') {
        return normalized;
    }
    return undefined;
}
//# sourceMappingURL=runtime-qa.js.map
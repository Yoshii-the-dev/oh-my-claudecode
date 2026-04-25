/**
 * `omc portfolio` — machine-readable product portfolio ledger helpers.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { migrateOpportunitiesToPortfolioLedger, readPortfolioLedger, renderPortfolioProjection, validatePortfolioLedger, writePortfolioProjection, } from '../../product/portfolio-ledger.js';
export async function portfolioValidateCommand(root, options, logger = console) {
    const report = validatePortfolioLedger(root);
    logger.log(options.json ? JSON.stringify(report, null, 2) : renderValidationReport(report));
    return report.ok ? 0 : 1;
}
export async function portfolioProjectCommand(root, options, logger = console) {
    const report = validatePortfolioLedger(root);
    if (!report.ok || !report.ledger) {
        logger.error(renderValidationReport(report));
        return 1;
    }
    if (options.write) {
        const path = writePortfolioProjection(root, options.output);
        logger.log(options.json ? JSON.stringify({ path }, null, 2) : colors.green(`Wrote ${path}`));
        return 0;
    }
    const ledger = readPortfolioLedger(root);
    if (!ledger) {
        logger.error(colors.red('Missing portfolio ledger'));
        return 1;
    }
    logger.log(options.json ? JSON.stringify(ledger, null, 2) : renderPortfolioProjection(ledger));
    return 0;
}
export async function portfolioMigrateCommand(root, options, logger = console) {
    const report = migrateOpportunitiesToPortfolioLedger(root, options);
    if (options.json) {
        logger.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
    }
    if (!report.ok) {
        logger.error(renderMigrationReport(report));
        return 1;
    }
    if (options.write) {
        logger.log(renderMigrationReport(report));
        return 0;
    }
    logger.log(JSON.stringify(report.ledger, null, 2));
    return 0;
}
function renderValidationReport(report) {
    const lines = [
        colors.bold('Portfolio ledger validation'),
        `path: ${report.path}`,
        `items: ${report.summary.items}, selected: ${report.summary.selected}, lanes: ${report.summary.lanes}`,
    ];
    if (report.issues.length > 0) {
        lines.push('');
        lines.push(renderTable(report.issues.map((issue) => ({
            severity: issue.severity === 'error' ? colors.red(issue.severity) : colors.yellow(issue.severity),
            code: issue.code,
            message: issue.message,
        })), [
            { header: 'severity', field: 'severity', width: 10 },
            { header: 'code', field: 'code', width: 24 },
            { header: 'message', field: 'message', width: 80 },
        ]));
    }
    lines.push('');
    lines.push(report.ok ? colors.green('Pass') : colors.red(`Fail: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`));
    return lines.join('\n');
}
function renderMigrationReport(report) {
    const lines = [
        colors.bold('Portfolio migration'),
        `source: ${report.sourcePath}`,
        `output: ${report.outputPath}`,
        `items: ${report.ledger?.items.length ?? 0}`,
    ];
    if (report.projectionPath) {
        lines.push(`projection: ${report.projectionPath}`);
    }
    if (report.issues.length > 0) {
        lines.push('');
        lines.push(renderTable(report.issues.map((issue) => ({
            severity: issue.severity === 'error' ? colors.red(issue.severity) : colors.yellow(issue.severity),
            code: issue.code,
            message: issue.message,
        })), [
            { header: 'severity', field: 'severity', width: 10 },
            { header: 'code', field: 'code', width: 24 },
            { header: 'message', field: 'message', width: 80 },
        ]));
    }
    lines.push('');
    lines.push(report.ok
        ? colors.green(report.wrote ? 'Wrote migrated portfolio ledger' : 'Migration preview is valid')
        : colors.red('Migration failed'));
    return lines.join('\n');
}
//# sourceMappingURL=portfolio.js.map
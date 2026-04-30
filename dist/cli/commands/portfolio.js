/**
 * `omc portfolio` — machine-readable product portfolio ledger helpers.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { migrateOpportunitiesToPortfolioLedger, readPortfolioLedger, renderPortfolioProjection, trimPortfolioLedger, validatePortfolioLedger, writePortfolioProjection, } from '../../product/portfolio-ledger.js';
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
export async function portfolioTrimCommand(root, options, logger = console) {
    const target = normalizeTrimTarget(options.to);
    const report = trimPortfolioLedger(root, {
        to: target,
        write: options.write === true,
    });
    if (options.json) {
        logger.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
    }
    if (!report.ok) {
        logger.error(renderTrimReport(report));
        return 1;
    }
    logger.log(renderTrimReport(report));
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
function renderTrimReport(report) {
    const lines = [
        colors.bold('Portfolio trim'),
        `path: ${report.path}`,
        `target: ${report.target}`,
        `items: ${report.originalCount} -> ${report.trimmedCount}`,
        `removed: ${report.removedCount}`,
        `written: ${report.wrote}`,
    ];
    if (report.projectionPath) {
        lines.push(`projection: ${report.projectionPath}`);
    }
    if (report.removedItems.length > 0) {
        lines.push('');
        lines.push(renderTable(report.removedItems.map((item) => ({
            id: item.id,
            lane: item.lane,
            status: item.status,
            title: item.title,
        })), [
            { header: 'id', field: 'id', width: 28 },
            { header: 'lane', field: 'lane', width: 16 },
            { header: 'status', field: 'status', width: 12 },
            { header: 'title', field: 'title', width: 70 },
        ]));
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
        ? colors.green(report.wrote ? 'Wrote trimmed portfolio ledger' : 'Trim preview is valid; re-run with --write to update the ledger')
        : colors.red('Trim failed'));
    return lines.join('\n');
}
function normalizeTrimTarget(value) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'number')
        return value;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}
//# sourceMappingURL=portfolio.js.map
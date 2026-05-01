/**
 * `omc product-regression` — cross-cycle regression and learning debt audit.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { generateProductRegressionAudit, renderProductRegressionAudit, writeProductRegressionAudit, } from '../../product/product-regression.js';
export async function productRegressionAuditCommand(root, options, logger = console) {
    const report = generateProductRegressionAudit({ root });
    const written = options.write ? writeProductRegressionAudit(root, report) : undefined;
    if (options.json) {
        logger.log(JSON.stringify({ ...report, written }, null, 2));
    }
    else if (options.write) {
        logger.log(renderProductRegressionSummary(report, written));
    }
    else {
        logger.log(renderProductRegressionAudit(report));
        logger.log(colors.gray('Use --write to persist .omc/product/regression/current.{json,md}.'));
    }
    return report.debts.some((debt) => debt.severity === 'error') ? 1 : 0;
}
function renderProductRegressionSummary(report, written) {
    const rows = report.debts.slice(0, 10).map((debt) => ({
        severity: debt.severity === 'error' ? colors.red(debt.severity) : colors.yellow(debt.severity),
        category: debt.category,
        subject: debt.subject,
        action: debt.recommended_action,
    }));
    return [
        colors.bold('Product regression audit'),
        `status: ${formatStatus(report.status)}`,
        `cycles: ${report.aggregates.cycles}, debts: ${report.aggregates.regression_debts}, errors: ${report.aggregates.error_debts}, scenario: ${report.aggregates.scenario_proof_debts}`,
        written ? `artifacts: ${written.jsonPath}, ${written.mdPath}` : undefined,
        '',
        rows.length > 0
            ? renderTable(rows, [
                { header: 'severity', field: 'severity', width: 10 },
                { header: 'category', field: 'category', width: 20 },
                { header: 'subject', field: 'subject', width: 38 },
                { header: 'action', field: 'action', width: 76 },
            ])
            : colors.green('No regression debts detected.'),
        '',
        `next_action: ${report.next_action}`,
    ].filter((line) => typeof line === 'string').join('\n');
}
function formatStatus(status) {
    if (status === 'stable')
        return colors.green(status);
    if (status === 'empty' || status === 'needs-repair')
        return colors.red(status);
    return colors.yellow(status);
}
//# sourceMappingURL=product-regression.js.map
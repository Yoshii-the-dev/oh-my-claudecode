/**
 * `omc doctor product-contracts` — validate product pipeline handoff artifacts.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { validateProductPipelineContracts, } from '../../product/pipeline-contract-validator.js';
import { PRODUCT_PIPELINE_CONTRACT_STAGES, isProductPipelineContractStage, } from '../../product/pipeline-registry.js';
export async function productContractsCommand(root, options) {
    const stage = options.stage ?? 'foundation-lite';
    if (!isProductPipelineContractStage(stage)) {
        console.error(colors.red(`Invalid product contract stage: ${stage}`));
        console.error(colors.gray(`Valid stages: ${PRODUCT_PIPELINE_CONTRACT_STAGES.join(', ')}`));
        return 2;
    }
    const report = validateProductPipelineContracts({
        root,
        stage,
    });
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
    }
    renderReport(report);
    return report.ok ? 0 : 1;
}
function renderReport(report) {
    console.log(colors.bold('Product pipeline contract validation'));
    console.log(`  root:  ${report.root}`);
    console.log(`  stage: ${report.stage}`);
    console.log();
    const rows = report.artifacts.map((artifact) => {
        const errors = artifact.issues.filter((issue) => issue.severity === 'error').length;
        const warnings = artifact.issues.length - errors;
        let status = colors.green('ok');
        if (!artifact.exists || errors > 0) {
            status = colors.red('error');
        }
        else if (warnings > 0) {
            status = colors.yellow('warning');
        }
        return {
            artifact: artifact.artifact,
            status,
            errors,
            warnings,
            metrics: summarizeMetrics(artifact.metrics),
        };
    });
    console.log(renderTable(rows, [
        { header: 'artifact', field: 'artifact', width: 16 },
        { header: 'status', field: 'status', width: 10 },
        { header: 'errors', field: 'errors', width: 6, align: 'right' },
        { header: 'warns', field: 'warnings', width: 5, align: 'right' },
        { header: 'metrics', field: 'metrics', width: 48 },
    ]));
    if (report.issues.length > 0) {
        console.log();
        for (const issue of report.issues) {
            const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
            console.log(`  ${marker} ${issue.artifact}/${issue.code}: ${issue.message}`);
        }
    }
    console.log();
    if (report.ok) {
        console.log(colors.green(`Pass: ${report.summary.warnings} warning(s).`));
    }
    else {
        console.log(colors.red(`Fail: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`));
    }
}
function summarizeMetrics(metrics) {
    const entries = Object.entries(metrics);
    if (entries.length === 0)
        return '-';
    return entries
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ')
        .slice(0, 48);
}
//# sourceMappingURL=product-contracts.js.map
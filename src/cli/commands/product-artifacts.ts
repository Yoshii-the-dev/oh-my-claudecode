/**
 * `omc doctor product-artifacts` — validate .omc product artifact inventory.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  validateProductArtifactInventory,
  type ProductArtifactInventoryReport,
} from '../../product/artifact-inventory.js';

export interface ProductArtifactsCommandOptions {
  json?: boolean;
}

export async function productArtifactsCommand(
  root: string | undefined,
  options: ProductArtifactsCommandOptions,
): Promise<number> {
  const report = validateProductArtifactInventory(root);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  renderReport(report);
  return report.ok ? 0 : 1;
}

function renderReport(report: ProductArtifactInventoryReport): void {
  console.log(colors.bold('Product artifact inventory'));
  console.log(`  root:          ${report.root}`);
  console.log(`  artifactRoot:  ${report.artifactRoot}`);
  console.log(`  filesScanned:  ${report.filesScanned}`);
  console.log(`  registered:    ${report.registeredCurrentArtifacts}/${report.summary.registeredArtifacts}`);

  if (report.issues.length > 0) {
    console.log();
    console.log(renderTable(report.issues.map((issue) => ({
      severity: issue.severity === 'error' ? colors.red(issue.severity) : colors.yellow(issue.severity),
      code: issue.code,
      path: issue.path,
      message: issue.message,
    })), [
      { header: 'severity', field: 'severity', width: 10 },
      { header: 'code', field: 'code', width: 30 },
      { header: 'path', field: 'path', width: 42 },
      { header: 'message', field: 'message', width: 80 },
    ]));
  }

  console.log();
  if (report.ok) {
    console.log(colors.green(`Pass: ${report.summary.warnings} warning(s).`));
  } else {
    console.log(colors.red(`Fail: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`));
  }
}

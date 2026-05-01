/**
 * `omc product-totality` — aggregate completed product work and missing depth.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  generateProductTotalityAudit,
  renderProductTotalityAudit,
  writeProductTotalityAudit,
  type ProductTotalityReport,
  type ProductTotalityScore,
} from '../../product/product-totality.js';
import {
  generateProductScenarioCoverageAudit,
  writeProductScenarioCoverageAudit,
} from '../../product/scenario-coverage.js';
import {
  generateProductScenarioPlan,
  writeProductScenarioPlan,
} from '../../product/scenario-generator.js';
import {
  generateProductRegressionAudit,
  writeProductRegressionAudit,
} from '../../product/product-regression.js';
import {
  generateProductCapabilityLifecycleAudit,
  writeProductCapabilityLifecycleAudit,
} from '../../product/capability-lifecycle.js';

export interface ProductTotalityCommandOptions {
  json?: boolean;
  write?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
}

export async function productTotalityAuditCommand(
  root: string | undefined,
  options: ProductTotalityCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = generateProductTotalityAudit(root);
  const written = options.write ? writeProductTotalityAudit(root, report) : undefined;
  const scenarioPlan = options.write ? generateProductScenarioPlan(root) : undefined;
  const scenarioPlanWritten = options.write && scenarioPlan
    ? writeProductScenarioPlan(root, scenarioPlan)
    : undefined;
  const scenarioReport = options.write
    ? generateProductScenarioCoverageAudit({ root, totality: report })
    : undefined;
  const scenarioWritten = options.write && scenarioReport
    ? writeProductScenarioCoverageAudit(root, scenarioReport)
    : undefined;
  const regressionReport = options.write && scenarioReport
    ? generateProductRegressionAudit({ root, totality: report, scenarioCoverage: scenarioReport })
    : undefined;
  const regressionWritten = options.write && regressionReport
    ? writeProductRegressionAudit(root, regressionReport)
    : undefined;
  const lifecycleReport = options.write && scenarioReport && regressionReport
    ? generateProductCapabilityLifecycleAudit({ root, totality: report, scenarioCoverage: scenarioReport, regression: regressionReport })
    : undefined;
  const lifecycleWritten = options.write && lifecycleReport
    ? writeProductCapabilityLifecycleAudit(root, lifecycleReport)
    : undefined;

  if (options.json) {
    logger.log(JSON.stringify({
      ...report,
      written,
      scenario_plan: scenarioPlan,
      scenario_plan_written: scenarioPlanWritten,
      scenario_coverage: scenarioReport,
      scenario_written: scenarioWritten,
      regression: regressionReport,
      regression_written: regressionWritten,
      capability_lifecycle: lifecycleReport,
      capability_lifecycle_written: lifecycleWritten,
    }, null, 2));
  } else if (options.write) {
    logger.log(renderProductTotalitySummary(report, written, scenarioPlanWritten, scenarioWritten, regressionWritten, lifecycleWritten));
  } else {
    logger.log(renderProductTotalityAudit(report));
    logger.log(colors.gray('Use --write to persist totality, capability graph, generated scenarios, scenario coverage, and regression current.{json,md} artifacts.'));
  }

  return report.gaps.some((gap) => gap.severity === 'error') ? 1 : 0;
}

function renderProductTotalitySummary(
  report: ProductTotalityReport,
  written: ReturnType<typeof writeProductTotalityAudit> | undefined,
  scenarioPlanWritten: ReturnType<typeof writeProductScenarioPlan> | undefined,
  scenarioWritten: ReturnType<typeof writeProductScenarioCoverageAudit> | undefined,
  regressionWritten: ReturnType<typeof writeProductRegressionAudit> | undefined,
  lifecycleWritten: ReturnType<typeof writeProductCapabilityLifecycleAudit> | undefined,
): string {
  const rows = Object.entries(report.scores).map(([dimension, score]) => ({
    dimension,
    status: formatScoreStatus(score),
    value: score.value.toFixed(2),
    detail: score.detail,
  }));

  return [
    colors.bold('Product totality audit'),
    `status: ${formatStatus(report.status)}`,
    `capabilities: ${report.aggregates.seeded_capabilities}, completed cycles: ${report.aggregates.completed_cycles}, gaps: ${report.gaps.length}, orphans: ${report.capability_graph.aggregates.orphan_count}`,
    written ? `artifacts: ${written.jsonPath}, ${written.mdPath}, ${written.capabilityGraphJsonPath}, ${written.capabilityGraphMdPath}` : undefined,
    scenarioPlanWritten ? `scenario_plan: ${scenarioPlanWritten.jsonPath}, ${scenarioPlanWritten.mdPath}` : undefined,
    scenarioWritten ? `scenario_coverage: ${scenarioWritten.jsonPath}, ${scenarioWritten.mdPath}` : undefined,
    regressionWritten ? `regression: ${regressionWritten.jsonPath}, ${regressionWritten.mdPath}` : undefined,
    lifecycleWritten ? `capability_lifecycle: ${lifecycleWritten.jsonPath}, ${lifecycleWritten.mdPath}, ${lifecycleWritten.historyJsonPath}, ${lifecycleWritten.historyMdPath}` : undefined,
    '',
    renderTable(rows, [
      { header: 'dimension', field: 'dimension', width: 18 },
      { header: 'status', field: 'status', width: 10 },
      { header: 'value', field: 'value', width: 7, align: 'right' },
      { header: 'detail', field: 'detail', width: 72 },
    ]),
    '',
    report.gaps.length > 0
      ? renderTable(report.gaps.slice(0, 8).map((gap) => ({
          severity: gap.severity === 'error' ? colors.red(gap.severity) : colors.yellow(gap.severity),
          code: gap.code,
          subject: gap.subject,
          action: gap.recommended_action,
        })), [
          { header: 'severity', field: 'severity', width: 10 },
          { header: 'code', field: 'code', width: 30 },
          { header: 'subject', field: 'subject', width: 34 },
          { header: 'action', field: 'action', width: 76 },
        ])
      : colors.green('No current totality gaps detected.'),
    '',
    `next_action: ${report.next_action}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function formatStatus(status: ProductTotalityReport['status']): string {
  if (status === 'balanced') return colors.green(status);
  if (status === 'empty' || status === 'under-composed') return colors.red(status);
  return colors.yellow(status);
}

function formatScoreStatus(score: ProductTotalityScore): string {
  if (score.status === 'good') return colors.green(score.status);
  if (score.status === 'warn') return colors.yellow(score.status);
  if (score.status === 'bad') return colors.red(score.status);
  return colors.gray(score.status);
}

export type { ProductTotalityReport };

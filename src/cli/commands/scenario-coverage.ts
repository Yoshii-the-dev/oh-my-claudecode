/**
 * `omc scenario-coverage` — map product capabilities to executable user-loop evidence.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  generateProductScenarioCoverageAudit,
  renderProductScenarioCoverageAudit,
  writeProductScenarioCoverageAudit,
  type ProductScenarioCoverageReport,
} from '../../product/scenario-coverage.js';

export interface ScenarioCoverageCommandOptions {
  json?: boolean;
  write?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
}

export async function scenarioCoverageAuditCommand(
  root: string | undefined,
  options: ScenarioCoverageCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = generateProductScenarioCoverageAudit({ root });
  const written = options.write ? writeProductScenarioCoverageAudit(root, report) : undefined;

  if (options.json) {
    logger.log(JSON.stringify({ ...report, written }, null, 2));
  } else if (options.write) {
    logger.log(renderScenarioCoverageSummary(report, written));
  } else {
    logger.log(renderProductScenarioCoverageAudit(report));
    logger.log(colors.gray('Use --write to persist .omc/product/scenario-coverage/current.{json,md}.'));
  }

  return report.gaps.some((gap) => gap.severity === 'error') ? 1 : 0;
}

function renderScenarioCoverageSummary(
  report: ProductScenarioCoverageReport,
  written: ReturnType<typeof writeProductScenarioCoverageAudit> | undefined,
): string {
  const rows = report.scenarios.slice(0, 10).map((scenario) => ({
    coverage: formatCoverage(scenario.coverage),
    capability: scenario.capability_title,
    loop: scenario.expected_user_loop,
    gaps: String(scenario.gaps.length),
  }));

  return [
    colors.bold('Product scenario coverage'),
    `status: ${formatStatus(report.status)}`,
    `scenarios: ${report.aggregates.scenario_count}, covered: ${report.aggregates.covered_scenarios}, missing: ${report.aggregates.missing_scenarios}, stale: ${report.aggregates.stale_scenarios}`,
    written ? `artifacts: ${written.jsonPath}, ${written.mdPath}` : undefined,
    '',
    rows.length > 0
      ? renderTable(rows, [
          { header: 'coverage', field: 'coverage', width: 18 },
          { header: 'capability', field: 'capability', width: 38 },
          { header: 'loop', field: 'loop', width: 72 },
          { header: 'gaps', field: 'gaps', width: 6, align: 'right' },
        ])
      : colors.yellow('No completed capability scenarios found.'),
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
      : colors.green('No scenario coverage gaps detected.'),
    '',
    `next_action: ${report.next_action}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function formatStatus(status: ProductScenarioCoverageReport['status']): string {
  if (status === 'covered') return colors.green(status);
  if (status === 'empty' || status === 'missing-scenarios' || status === 'runtime-failing') return colors.red(status);
  return colors.yellow(status);
}

function formatCoverage(coverage: string): string {
  if (coverage === 'runtime-passed') return colors.green(coverage);
  if (coverage === 'missing' || coverage === 'runtime-failed') return colors.red(coverage);
  return colors.yellow(coverage);
}

export type { ProductScenarioCoverageReport };

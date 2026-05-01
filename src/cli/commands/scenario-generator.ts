/**
 * `omc scenario-generator` — derive user-loop scenarios from feature expectation contracts.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  generateProductScenarioPlan,
  renderProductScenarioPlan,
  writeProductScenarioPlan,
  type ProductScenarioGenerationReport,
} from '../../product/scenario-generator.js';

export interface ScenarioGeneratorCommandOptions {
  json?: boolean;
  write?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
}

export async function scenarioGeneratorCommand(
  root: string | undefined,
  options: ScenarioGeneratorCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = generateProductScenarioPlan(root);
  const written = options.write ? writeProductScenarioPlan(root, report) : undefined;

  if (options.json) {
    logger.log(JSON.stringify({ ...report, written }, null, 2));
  } else if (options.write) {
    logger.log(renderScenarioGeneratorSummary(report, written));
  } else {
    logger.log(renderProductScenarioPlan(report));
    logger.log(colors.gray('Use --write to persist .omc/product/scenarios/current.{json,md}.'));
  }

  return report.gaps.some((gap) => gap.severity === 'error') ? 1 : 0;
}

function renderScenarioGeneratorSummary(
  report: ProductScenarioGenerationReport,
  written: ReturnType<typeof writeProductScenarioPlan> | undefined,
): string {
  const rows = report.scenarios.slice(0, 10).map((scenario) => ({
    scenario: scenario.id,
    capability: scenario.capability_title,
    loop: scenario.first_meaningful_use,
    steps: String(scenario.steps.length),
  }));

  return [
    colors.bold('Product scenario generator'),
    `status: ${formatStatus(report.status)}`,
    `cycles: ${report.aggregates.cycle_count}, scenarios: ${report.aggregates.scenario_count}, missing_expectations: ${report.aggregates.missing_expectation_count}`,
    written ? `artifacts: ${written.jsonPath}, ${written.mdPath}` : undefined,
    '',
    rows.length > 0
      ? renderTable(rows, [
          { header: 'scenario', field: 'scenario', width: 44 },
          { header: 'capability', field: 'capability', width: 38 },
          { header: 'loop', field: 'loop', width: 72 },
          { header: 'steps', field: 'steps', width: 6, align: 'right' },
        ])
      : colors.yellow('No feature expectation contracts produced generated scenarios.'),
    '',
    report.gaps.length > 0
      ? renderTable(report.gaps.slice(0, 8).map((gap) => ({
          severity: gap.severity === 'error' ? colors.red(gap.severity) : colors.yellow(gap.severity),
          code: gap.code,
          subject: gap.subject,
          action: gap.recommended_action,
        })), [
          { header: 'severity', field: 'severity', width: 10 },
          { header: 'code', field: 'code', width: 32 },
          { header: 'subject', field: 'subject', width: 34 },
          { header: 'action', field: 'action', width: 76 },
        ])
      : colors.green('No scenario generation gaps detected.'),
    '',
    `next_action: ${report.next_action}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function formatStatus(status: ProductScenarioGenerationReport['status']): string {
  if (status === 'ready') return colors.green(status);
  if (status === 'empty' || status === 'needs-expectation') return colors.red(status);
  return colors.yellow(status);
}

export type { ProductScenarioGenerationReport };

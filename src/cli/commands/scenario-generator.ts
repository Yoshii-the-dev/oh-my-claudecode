/**
 * `omc scenario-generator` — derive user-loop scenarios from feature expectation contracts.
 */

import { colors, renderTable } from '../utils/formatting.js';
import { runRuntimeQa, writeRuntimeQaRunReport, type RuntimeQaRunReport } from '../../runtime-qa/runner.js';
import {
  applyGeneratedScenariosToRuntimeQa,
  generateProductScenarioPlan,
  renderProductScenarioPlan,
  writeProductScenarioPlan,
  type ProductScenarioGenerationReport,
  type ProductScenarioRuntimeQaResult,
} from '../../product/scenario-generator.js';

export interface ScenarioGeneratorCommandOptions {
  json?: boolean;
  write?: boolean;
  applyRuntimeQa?: boolean;
  runRuntimeQa?: boolean;
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
  const runtimeQa = options.applyRuntimeQa || options.runRuntimeQa
    ? applyGeneratedScenariosToRuntimeQa({ root, report, write: options.write || options.runRuntimeQa })
    : undefined;
  const runtimeQaRun = options.runRuntimeQa && runtimeQa?.runtime_supported
    ? runRuntimeQa({ root, auto: true })
    : undefined;
  const runtimeQaRunWritten = runtimeQaRun ? writeRuntimeQaRunReport(root ?? process.cwd(), runtimeQaRun) : undefined;

  if (options.json) {
    logger.log(JSON.stringify({ ...report, written, runtime_qa: runtimeQa, runtime_qa_run: runtimeQaRun, runtime_qa_run_written: runtimeQaRunWritten }, null, 2));
  } else if (options.write) {
    logger.log(renderScenarioGeneratorSummary(report, written, runtimeQa, runtimeQaRun));
  } else {
    logger.log(renderProductScenarioPlan(report));
    if (runtimeQa) logger.log(renderRuntimeQaSummary(runtimeQa, runtimeQaRun));
    logger.log(colors.gray('Use --write to persist .omc/product/scenarios/current.{json,md}.'));
  }

  if (runtimeQaRun && runtimeQaRun.status !== 'passed') return 1;
  if (runtimeQa && runtimeQa.status === 'needs-harness') return 1;
  return report.gaps.some((gap) => gap.severity === 'error') ? 1 : 0;
}

function renderScenarioGeneratorSummary(
  report: ProductScenarioGenerationReport,
  written: ReturnType<typeof writeProductScenarioPlan> | undefined,
  runtimeQa: ProductScenarioRuntimeQaResult | undefined,
  runtimeQaRun: RuntimeQaRunReport | undefined,
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
    runtimeQa ? renderRuntimeQaSummary(runtimeQa, runtimeQaRun) : undefined,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function renderRuntimeQaSummary(
  result: ProductScenarioRuntimeQaResult,
  run: RuntimeQaRunReport | undefined,
): string {
  return [
    '',
    colors.bold('Generated scenario runtime QA'),
    `status: ${formatRuntimeQaStatus(result.status)}`,
    `runtime_supported: ${result.runtime_supported}`,
    `flows: ${result.flow_count}, added: ${result.added_flows.length}, written: ${result.written}`,
    run ? `runtime_qa_run: ${run.status} (${run.adapter})` : undefined,
    `next_action: ${result.next_action}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function formatStatus(status: ProductScenarioGenerationReport['status']): string {
  if (status === 'ready') return colors.green(status);
  if (status === 'empty' || status === 'needs-expectation') return colors.red(status);
  return colors.yellow(status);
}

function formatRuntimeQaStatus(status: ProductScenarioRuntimeQaResult['status']): string {
  if (status === 'applied' || status === 'current') return colors.green(status);
  if (status === 'needs-harness') return colors.red(status);
  return colors.yellow(status);
}

export type { ProductScenarioGenerationReport };

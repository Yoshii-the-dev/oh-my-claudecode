/**
 * `omc run-scorecard` — product/agent pipeline quality metrics.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  generateRunScorecard,
  type RunScorecardMetric,
  type RunScorecardReport,
} from '../../product/run-scorecard.js';

export interface RunScorecardCommandOptions {
  json?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
}

export async function runScorecardCommand(
  root: string | undefined,
  options: RunScorecardCommandOptions,
  logger: LoggerLike = console,
): Promise<RunScorecardReport> {
  const report = generateRunScorecard(root);
  logger.log(options.json ? JSON.stringify(report, null, 2) : renderRunScorecard(report));
  return report;
}

function renderRunScorecard(report: RunScorecardReport): string {
  const rows = Object.entries(report.metrics).map(([name, metric]) => ({
    metric: name,
    status: formatStatus(metric.status),
    value: formatMetricValue(metric),
    detail: metric.detail,
  }));

  return [
    colors.bold('Run scorecard'),
    `root: ${report.root}`,
    `artifacts: ${report.totals.artifacts}, handoffs: ${report.totals.handoffs}, decisions: ${report.totals.decisions}`,
    '',
    renderTable(rows, [
      { header: 'metric', field: 'metric', width: 38 },
      { header: 'status', field: 'status', width: 10 },
      { header: 'value', field: 'value', width: 12, align: 'right' },
      { header: 'detail', field: 'detail', width: 72 },
    ]),
  ].join('\n');
}

function formatStatus(status: RunScorecardMetric['status']): string {
  if (status === 'good') return colors.green('good');
  if (status === 'warn') return colors.yellow('warn');
  if (status === 'bad') return colors.red('bad');
  return colors.gray('unknown');
}

function formatMetricValue(metric: RunScorecardMetric): string {
  if (metric.value === null) return '-';
  if (metric.unit === '%') return `${Math.round(metric.value * 100)}%`;
  if (metric.unit === 'ratio') return metric.value.toFixed(2);
  return `${metric.value} ${metric.unit}`;
}

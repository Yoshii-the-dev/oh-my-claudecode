/**
 * `omc historical-scorecard` — compare run quality between cycles.
 */

import { colors, renderTable } from '../utils/formatting.js';
import { generateHistoricalScorecard, type HistoricalScorecardReport } from '../../product/historical-scorecard.js';

export interface HistoricalScorecardCommandOptions {
  json?: boolean;
}

export async function historicalScorecardCommand(
  root: string | undefined,
  options: HistoricalScorecardCommandOptions,
  logger = console,
): Promise<number> {
  const report = generateHistoricalScorecard(root);

  if (options.json) {
    logger.log(JSON.stringify(report, null, 2));
    return 0;
  }

  logger.log(colors.bold(`Historical scorecard — ${report.totals.cycles} cycle${report.totals.cycles === 1 ? '' : 's'}`));
  logger.log(`  artifact root: ${report.artifactRoot}`);
  logger.log(`  completed: ${report.totals.completed}`);
  logger.log(`  blocked:   ${report.totals.blocked}`);

  if (report.cycles.length === 0) {
    logger.log('');
    logger.log(colors.gray('No dated cycles found in .omc/cycles/.'));
    return 0;
  }

  logger.log('');
  logger.log(renderTable(report.cycles.map((cycle) => ({
    cycle_id: cycle.cycle_id,
    stage: cycle.cycle_stage,
    build_route: cycle.build_route,
    confidence: typeof cycle.confidence === 'number' ? cycle.confidence.toFixed(2) : String(cycle.confidence),
    days: cycle.time_to_complete_days ?? '-',
    user_visible: cycle.user_visible_count,
    infra: cycle.infrastructure_count,
    learning: cycle.has_learning_capture ? 'yes' : 'no',
  })), [
    { header: 'cycle_id', field: 'cycle_id', width: 26 },
    { header: 'stage', field: 'stage', width: 10 },
    { header: 'route', field: 'build_route', width: 18 },
    { header: 'conf', field: 'confidence', width: 6 },
    { header: 'days', field: 'days', width: 5, align: 'right' },
    { header: 'user', field: 'user_visible', width: 4, align: 'right' },
    { header: 'infra', field: 'infra', width: 5, align: 'right' },
    { header: 'learn', field: 'learning', width: 5 },
  ]));

  if (report.trends.some((trend) => trend.direction !== 'unknown')) {
    logger.log('');
    logger.log(colors.bold('Trends (latest vs previous):'));
    for (const trend of report.trends) {
      if (trend.direction === 'unknown') continue;
      const marker = trend.direction === 'improving'
        ? colors.green('improving')
        : trend.direction === 'regressing'
          ? colors.red('regressing')
          : colors.gray('flat');
      logger.log(`  ${marker.padEnd(20)} ${trend.metric}${trend.delta !== null ? ` (delta ${trend.delta.toFixed(2)})` : ''}`);
    }
  }

  if (report.comparison.improvements.length > 0 || report.comparison.regressions.length > 0) {
    logger.log('');
    if (report.comparison.improvements.length > 0) {
      logger.log(colors.bold('Improvements:'));
      for (const entry of report.comparison.improvements) {
        logger.log(`  ${colors.green('+')} ${entry}`);
      }
    }
    if (report.comparison.regressions.length > 0) {
      logger.log(colors.bold('Regressions:'));
      for (const entry of report.comparison.regressions) {
        logger.log(`  ${colors.red('-')} ${entry}`);
      }
    }
  }

  return 0;
}

export type { HistoricalScorecardReport };

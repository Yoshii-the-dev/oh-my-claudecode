/**
 * `omc capability-lifecycle` — classify completed capabilities into lifecycle stages.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  generateProductCapabilityLifecycleAudit,
  generateProductCapabilityLifecycleHistory,
  renderProductCapabilityLifecycleAudit,
  writeProductCapabilityLifecycleAudit,
  type ProductCapabilityLifecycleHistoryReport,
  type ProductCapabilityLifecycleReport,
} from '../../product/capability-lifecycle.js';

export interface CapabilityLifecycleCommandOptions {
  json?: boolean;
  write?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
}

export async function capabilityLifecycleAuditCommand(
  root: string | undefined,
  options: CapabilityLifecycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = generateProductCapabilityLifecycleAudit({ root });
  const history = generateProductCapabilityLifecycleHistory({ root, current: report });
  const written = options.write ? writeProductCapabilityLifecycleAudit(root, report, history) : undefined;

  if (options.json) {
    logger.log(JSON.stringify({ ...report, history, written }, null, 2));
  } else if (options.write) {
    logger.log(renderCapabilityLifecycleSummary(report, history, written));
  } else {
    logger.log(renderProductCapabilityLifecycleAudit(report));
    logger.log(colors.gray('Use --write to persist .omc/product/capability-lifecycle/current.{json,md}.'));
  }

  return report.capabilities.some((capability) => capability.stage === 'remove-candidate') ? 1 : 0;
}

function renderCapabilityLifecycleSummary(
  report: ProductCapabilityLifecycleReport,
  history: ProductCapabilityLifecycleHistoryReport,
  written: ReturnType<typeof writeProductCapabilityLifecycleAudit> | undefined,
): string {
  const rows = report.capabilities.slice(0, 10).map((capability) => ({
    stage: formatStage(capability.stage),
    decision: capability.decision,
    capability: capability.title,
    scenario: capability.scenario_coverage,
    action: capability.recommended_action,
  }));

  return [
    colors.bold('Product capability lifecycle'),
    `status: ${formatStatus(report.status)}`,
    `capabilities: ${report.aggregates.capability_count}, seeded: ${report.aggregates.seeded}, proving: ${report.aggregates.proving}, mature: ${report.aggregates.mature}, remove_candidates: ${report.aggregates.remove_candidates}`,
    `history: events ${history.aggregates.event_count}, transitions ${history.aggregates.transition_count}, progressed ${history.aggregates.progressed_capabilities}, regressed ${history.aggregates.regressed_capabilities}, triaged ${history.aggregates.triaged_capabilities}`,
    written ? `artifacts: ${written.jsonPath}, ${written.mdPath}, ${written.historyJsonPath}, ${written.historyMdPath}` : undefined,
    '',
    rows.length > 0
      ? renderTable(rows, [
          { header: 'stage', field: 'stage', width: 18 },
          { header: 'decision', field: 'decision', width: 18 },
          { header: 'capability', field: 'capability', width: 38 },
          { header: 'scenario', field: 'scenario', width: 16 },
          { header: 'action', field: 'action', width: 76 },
        ])
      : colors.yellow('No completed capabilities found.'),
    '',
    `next_action: ${report.next_action}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function formatStatus(status: ProductCapabilityLifecycleReport['status']): string {
  if (status === 'healthy') return colors.green(status);
  if (status === 'empty' || status === 'needs-triage') return colors.red(status);
  return colors.yellow(status);
}

function formatStage(stage: string): string {
  if (stage === 'mature') return colors.green(stage);
  if (stage === 'remove-candidate' || stage === 'deprecated') return colors.red(stage);
  return colors.yellow(stage);
}

export type { ProductCapabilityLifecycleReport };

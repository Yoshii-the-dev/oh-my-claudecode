/**
 * `omc product-cycle` — runtime FSM for the product learning loop.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  advanceProductCycle,
  getNextProductCycleAction,
  isProductCycleStage,
  validateProductCycle,
  type ProductCycleSnapshot,
} from '../../product/cycle-fsm.js';

export interface ProductCycleCommandOptions {
  json?: boolean;
  to?: string;
  goal?: string;
  force?: boolean;
}

interface LoggerLike {
  log: (message?: unknown) => void;
  error: (message?: unknown) => void;
}

export async function productCycleStatusCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = getNextProductCycleAction(root);
  logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
  return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}

export async function productCycleNextCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = getNextProductCycleAction(root);
  if (options.json) {
    logger.log(JSON.stringify({ nextAction: snapshot.nextAction, nextStage: snapshot.nextStage, snapshot }, null, 2));
  } else {
    logger.log(snapshot.nextAction);
  }
  return 0;
}

export async function productCycleValidateCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = validateProductCycle(root);
  logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
  return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}

export async function productCycleAdvanceCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const to = options.to;
  if (!to || !isProductCycleStage(to)) {
    logger.error(colors.red(`Invalid or missing target stage: ${to ?? '<missing>'}`));
    logger.error(colors.gray('Valid stages: discover, rank, select, spec, build, verify, learn, complete, blocked'));
    return 2;
  }

  const result = advanceProductCycle({
    root,
    to,
    goal: options.goal,
    force: options.force,
  });

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    logger.log(colors.green(`Advanced product cycle${result.from ? `: ${result.from} -> ${result.to}` : ` to ${result.to}`}`));
    logger.log(renderSnapshot(result.snapshot));
  } else {
    logger.error(colors.red(`Cannot advance product cycle to ${result.to}`));
    for (const issue of result.issues) {
      logger.error(`  ${issue.severity}: ${issue.code}: ${issue.message}`);
    }
  }

  return result.ok ? 0 : 1;
}

function renderSnapshot(snapshot: ProductCycleSnapshot): string {
  const rows = [
    { field: 'path', value: snapshot.path },
    { field: 'exists', value: String(snapshot.exists) },
    { field: 'cycle_id', value: snapshot.cycleId ?? '-' },
    { field: 'cycle_goal', value: snapshot.cycleGoal ?? '-' },
    { field: 'cycle_stage', value: snapshot.stage ?? '-' },
    { field: 'next_stage', value: snapshot.nextStage ?? '-' },
    { field: 'build_route', value: snapshot.buildRoute ?? '-' },
  ];

  const lines = [
    colors.bold('Product cycle FSM'),
    renderTable(rows, [
      { header: 'field', field: 'field', width: 14 },
      { header: 'value', field: 'value', width: 80 },
    ]),
    '',
    `${colors.bold('next_action')}: ${snapshot.nextAction}`,
  ];

  if (snapshot.issues.length > 0) {
    lines.push('');
    for (const issue of snapshot.issues) {
      const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
      lines.push(`${marker} ${issue.code}: ${issue.message}`);
    }
  }

  return lines.join('\n');
}

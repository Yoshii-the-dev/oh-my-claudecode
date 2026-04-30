import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CYCLE_PROJECTION_RELATIVE_PATH,
  getCycleProjectionPath,
  readCycleDocument,
  renderCycleProjection,
  writeCycleProjection,
} from './cycle-document.js';
import {
  LEARNING_PROJECTION_RELATIVE_PATH,
  getLearningProjectionPath,
  readLearningDocument,
  renderLearningProjection,
  writeLearningProjection,
} from './learning-document.js';
import {
  PORTFOLIO_LEDGER_RELATIVE_PATH,
  PORTFOLIO_PROJECTION_RELATIVE_PATH,
  readPortfolioLedger,
  renderPortfolioProjection,
  validatePortfolioLedger,
  writePortfolioProjection,
} from './portfolio-ledger.js';
import {
  migrateRuntimeQaConfig,
  RUNTIME_QA_CONFIG_RELATIVE_PATH,
  readRuntimeQaConfigRaw,
  shouldRunRuntimeQa,
} from '../runtime-qa/runner.js';
import { setupRuntimeQaPrerequisites } from '../runtime-qa/setup.js';
import { diagnoseRuntimeQa } from '../runtime-qa/diagnostics.js';

export type ProductCycleRepairStatus = 'passed' | 'changed' | 'needed' | 'skipped' | 'blocked';

export interface ProductCycleRepairAction {
  id: string;
  status: ProductCycleRepairStatus;
  path?: string;
  message: string;
  command?: string;
}

export interface ProductCycleRepairReport {
  ok: boolean;
  root: string;
  safe: boolean;
  actions: ProductCycleRepairAction[];
  summary: {
    passed: number;
    changed: number;
    needed: number;
    skipped: number;
    blocked: number;
  };
}

export interface ProductCycleRepairOptions {
  safe?: boolean;
}

export function repairProductCycle(
  root = process.cwd(),
  options: ProductCycleRepairOptions = {},
): ProductCycleRepairReport {
  const resolvedRoot = resolve(root);
  const safe = options.safe === true;
  const actions: ProductCycleRepairAction[] = [
    repairCycleProjection(resolvedRoot, safe),
    repairLearningProjection(resolvedRoot, safe),
    repairPortfolioProjection(resolvedRoot, safe),
    inspectRuntimeQaRepair(resolvedRoot),
  ];
  const summary = {
    passed: actions.filter((action) => action.status === 'passed').length,
    changed: actions.filter((action) => action.status === 'changed').length,
    needed: actions.filter((action) => action.status === 'needed').length,
    skipped: actions.filter((action) => action.status === 'skipped').length,
    blocked: actions.filter((action) => action.status === 'blocked').length,
  };
  return {
    ok: safe ? summary.blocked === 0 && summary.needed === 0 : true,
    root: resolvedRoot,
    safe,
    actions,
    summary,
  };
}

function repairCycleProjection(root: string, safe: boolean): ProductCycleRepairAction {
  const document = readCycleDocument(root);
  const path = getCycleProjectionPath(root);
  if (!document) {
    return {
      id: 'cycle-projection',
      status: 'skipped',
      path,
      message: 'No typed cycle document exists; migrate with `omc product-cycle migrate-document --write` first.',
      command: 'omc product-cycle migrate-document --write',
    };
  }

  const expected = renderCycleProjection(document);
  if (projectionMatches(path, expected)) {
    return {
      id: 'cycle-projection',
      status: 'passed',
      path,
      message: `${CYCLE_PROJECTION_RELATIVE_PATH} matches ${document.cycle_id}.`,
    };
  }

  if (safe) {
    const written = writeCycleProjection(root, document);
    return {
      id: 'cycle-projection',
      status: 'changed',
      path: written,
      message: `Re-rendered ${CYCLE_PROJECTION_RELATIVE_PATH} from typed cycle JSON.`,
    };
  }

  return {
    id: 'cycle-projection',
    status: 'needed',
    path,
    message: `${CYCLE_PROJECTION_RELATIVE_PATH} is missing or stale.`,
    command: 'omc product-cycle repair --safe',
  };
}

function repairLearningProjection(root: string, safe: boolean): ProductCycleRepairAction {
  const document = readLearningDocument(root);
  const path = getLearningProjectionPath(root);
  if (!document) {
    return {
      id: 'learning-projection',
      status: 'skipped',
      path,
      message: 'No typed learning document exists.',
      command: 'omc learning migrate --write',
    };
  }

  const expected = renderLearningProjection(document);
  if (projectionMatches(path, expected)) {
    return {
      id: 'learning-projection',
      status: 'passed',
      path,
      message: `${LEARNING_PROJECTION_RELATIVE_PATH} matches ${document.cycle_id}.`,
    };
  }

  if (safe) {
    const written = writeLearningProjection(root, document);
    return {
      id: 'learning-projection',
      status: 'changed',
      path: written,
      message: `Re-rendered ${LEARNING_PROJECTION_RELATIVE_PATH} from typed learning JSON.`,
    };
  }

  return {
    id: 'learning-projection',
    status: 'needed',
    path,
    message: `${LEARNING_PROJECTION_RELATIVE_PATH} is missing or stale.`,
    command: 'omc product-cycle repair --safe',
  };
}

function repairPortfolioProjection(root: string, safe: boolean): ProductCycleRepairAction {
  const ledger = readPortfolioLedger(root);
  const validation = validatePortfolioLedger(root);
  const path = resolve(root, PORTFOLIO_PROJECTION_RELATIVE_PATH);
  if (!ledger) {
    return {
      id: 'portfolio-projection',
      status: 'skipped',
      path,
      message: `No ${PORTFOLIO_LEDGER_RELATIVE_PATH} exists.`,
      command: 'omc portfolio migrate --write',
    };
  }
  if (!validation.ok) {
    return {
      id: 'portfolio-projection',
      status: 'blocked',
      path: validation.path,
      message: `Portfolio ledger has ${validation.summary.errors} error(s); repair ledger before projecting.`,
      command: validation.issues.some((issue) => issue.code === 'portfolio-too-large')
        ? 'omc portfolio trim --to 40 --write'
        : 'omc portfolio validate',
    };
  }

  const expected = renderPortfolioProjection(ledger);
  if (projectionMatches(path, expected)) {
    return {
      id: 'portfolio-projection',
      status: 'passed',
      path,
      message: `${PORTFOLIO_PROJECTION_RELATIVE_PATH} matches ${PORTFOLIO_LEDGER_RELATIVE_PATH}.`,
    };
  }

  if (safe) {
    const written = writePortfolioProjection(root);
    return {
      id: 'portfolio-projection',
      status: 'changed',
      path: written,
      message: `Re-rendered ${PORTFOLIO_PROJECTION_RELATIVE_PATH} from portfolio ledger.`,
    };
  }

  return {
    id: 'portfolio-projection',
    status: 'needed',
    path,
    message: `${PORTFOLIO_PROJECTION_RELATIVE_PATH} is missing or stale.`,
    command: 'omc product-cycle repair --safe',
  };
}

function inspectRuntimeQaRepair(root: string): ProductCycleRepairAction {
  if (!shouldRunRuntimeQa(root)) {
    return {
      id: 'runtime-qa',
      status: 'skipped',
      message: 'Runtime QA is not configured or requested by the current cycle.',
    };
  }

  const migration = migrateRuntimeQaConfig({ root, write: false });
  if (migration.changed) {
    return {
      id: 'runtime-qa',
      status: 'needed',
      path: migration.path,
      message: `${RUNTIME_QA_CONFIG_RELATIVE_PATH} can be migrated to the canonical schema.`,
      command: 'omc runtime-qa migrate --write',
    };
  }

  const rawConfig = readRuntimeQaConfigRaw(root);
  if (!rawConfig) {
    return {
      id: 'runtime-qa',
      status: 'blocked',
      path: resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH),
      message: 'Runtime QA is requested but no config exists.',
      command: 'omc runtime-qa init',
    };
  }

  const setup = setupRuntimeQaPrerequisites(root);
  if (setup.steps.length > 0) {
    const commandSteps = setup.steps.filter((step) => step.kind === 'command').length;
    const manualSteps = setup.steps.filter((step) => step.kind === 'manual').length;
    return {
      id: 'runtime-qa',
      status: commandSteps > 0 ? 'needed' : 'blocked',
      path: setup.doctor.configPath,
      message: `Runtime QA setup has ${commandSteps} command step(s) and ${manualSteps} manual step(s).`,
      command: commandSteps > 0 ? 'omc runtime-qa setup --apply' : 'omc runtime-qa setup',
    };
  }

  const doctor = diagnoseRuntimeQa(root);
  if (!doctor.ok) {
    return {
      id: 'runtime-qa',
      status: 'blocked',
      path: doctor.configPath,
      message: `Runtime QA doctor reports ${doctor.summary.errors} error(s).`,
      command: 'omc doctor runtime-qa',
    };
  }

  return {
    id: 'runtime-qa',
    status: 'passed',
    path: doctor.configPath,
    message: 'Runtime QA setup and evidence are ready.',
  };
}

function projectionMatches(path: string, expected: string): boolean {
  if (!existsSync(path)) return false;
  return normalizeProjection(readFileSync(path, 'utf-8')) === normalizeProjection(expected);
}

function normalizeProjection(content: string): string {
  return content.trim().replace(/\r\n/g, '\n');
}

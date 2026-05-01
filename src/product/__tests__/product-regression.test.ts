import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCT_REGRESSION_JSON_RELATIVE_PATH,
  PRODUCT_REGRESSION_MD_RELATIVE_PATH,
  generateProductRegressionAudit,
  writeProductRegressionAudit,
} from '../product-regression.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('generateProductRegressionAudit', () => {
  it('reports empty before historical cycles exist', () => {
    const root = createRoot();

    const report = generateProductRegressionAudit({ root });

    expect(report.status).toBe('empty');
    expect(report.aggregates.cycles).toBe(0);
  });

  it('flags completed cycles with no learning capture as repair debt', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/2026-04-25-row-counter.json', JSON.stringify(cycleDocument(), null, 2));

    const report = generateProductRegressionAudit({ root });

    expect(report.status).toBe('needs-repair');
    expect(report.debts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '2026-04-25-row-counter-missing-learning',
        severity: 'error',
        category: 'learning',
      }),
    ]));
  });

  it('carries scenario coverage gaps as regression debt', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/2026-04-25-row-counter.json', JSON.stringify(cycleDocument(), null, 2));
    writeArtifact(root, '.omc/learning/2026-04-25-row-counter.json', JSON.stringify(learningDocument(), null, 2));
    writeConnectedContext(root);

    const report = generateProductRegressionAudit({ root });

    expect(report.status).toBe('needs-scenario-proof');
    expect(report.aggregates.scenario_proof_debts).toBeGreaterThan(0);
    expect(report.debts.map((debt) => debt.category)).toContain('scenario-proof');
  });

  it('writes JSON and markdown projections', () => {
    const root = createRoot();

    const written = writeProductRegressionAudit(root);

    expect(written.jsonPath).toContain(PRODUCT_REGRESSION_JSON_RELATIVE_PATH);
    expect(written.mdPath).toContain(PRODUCT_REGRESSION_MD_RELATIVE_PATH);
    expect(existsSync(join(root, PRODUCT_REGRESSION_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_REGRESSION_MD_RELATIVE_PATH))).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-product-regression-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${content}\n`, 'utf-8');
}

function cycleDocument(): unknown {
  return {
    schema_version: 1,
    cycle_id: '2026-04-25-row-counter',
    cycle_goal: 'ship row counter seed',
    cycle_stage: 'complete',
    product_stage: 'pre-mvp',
    stage_checklist: {
      discover: true,
      rank: true,
      select: true,
      spec: true,
      build: true,
      verify: true,
      learn: true,
    },
    selected_portfolio: {
      core_product_slice: 'count rows while knitting a pattern',
      enabling_task: 'persist row number',
      learning_task: 'dogfood row counter',
    },
    spec: {
      acceptance_criteria: ['button increments current row'],
      build_route: 'product-pipeline',
      verification_plan: ['npm test'],
      learning_plan: ['dogfood a sample pattern'],
      feature_expectation_contract: {
        user_job: 'continue a knitting pattern without losing place',
        first_meaningful_use: 'open a pattern, count rows, close, and resume later',
        useless_if: ['row value is isolated from pattern context'],
        maturity_ladder: {
          v0: 'manual row count works',
          v1: 'row count is attached to pattern context',
          v2: 'row count coordinates with mistake recovery',
        },
        not_done_until: ['user can resume the row in the next session'],
      },
    },
    footer: {
      status: 'ok',
      evidence: ['fixture'],
      confidence: 0.7,
      blocking_issues: [],
      next_action: 'capture learning',
      artifacts_written: ['.omc/cycles/2026-04-25-row-counter.json'],
    },
    history: [
      { stage: 'discover', at: '2026-04-25T00:00:00.000Z' },
      { stage: 'complete', at: '2026-04-25T00:00:00.000Z' },
    ],
    updated_at: '2026-04-25T00:00:00.000Z',
  };
}

function learningDocument(): unknown {
  return {
    schema_version: 1,
    cycle_id: '2026-04-25-row-counter',
    shipped_outcome: 'Manual row counter shipped.',
    evidence_collected: ['fixture'],
    user_product_learning: ['standalone counting is too thin without pattern context'],
    invalidated_assumptions: ['a naked counter is enough'],
    recommended_next_cycle: 'attach row count to pattern context',
    next_candidate_adjustments: ['add pattern context'],
    footer: {
      status: 'ok',
      evidence: ['fixture'],
      confidence: 0.8,
      blocking_issues: [],
      next_action: 'audit regression',
      artifacts_written: ['.omc/learning/2026-04-25-row-counter.json'],
    },
    captured_at: '2026-04-25T00:00:00.000Z',
  };
}

function writeConnectedContext(root: string): void {
  writeArtifact(root, '.omc/portfolio/current.json', JSON.stringify({
    schema_version: 1,
    updated_at: '2026-04-25T00:00:00.000Z',
    source_artifacts: ['fixture'],
    items: [{
      id: 'row-counter-v1',
      title: 'count rows while knitting a pattern with row count attached to pattern context',
      lane: 'product',
      status: 'selected',
      confidence: 'MEDIUM',
      dependencies: [],
      selected_cycle: '2026-04-25-row-counter',
      evidence: ['fixture'],
      type: 'core-product-slice',
      user_visible: true,
    }],
  }, null, 2));
  writeArtifact(root, '.omc/roadmap/current.md', [
    'row count is attached to pattern context',
    'row count coordinates with mistake recovery',
    'user can resume the row in the next session',
  ].join('\n'));
  writeArtifact(root, '.omc/ecosystem/current.md', 'Row counting connects to pattern context, project history, and mistake recovery.');
  writeArtifact(root, '.omc/meaning/current.md', 'Meaning: calm return-session progress while knitting.');
}

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH,
  PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH,
  generateProductScenarioCoverageAudit,
  writeProductScenarioCoverageAudit,
} from '../scenario-coverage.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('generateProductScenarioCoverageAudit', () => {
  it('reports empty when no completed capabilities exist', () => {
    const root = createRoot();

    const report = generateProductScenarioCoverageAudit({ root });

    expect(report.status).toBe('empty');
    expect(report.gaps.map((gap) => gap.code)).toContain('no-capability-scenarios');
  });

  it('marks a capability covered when runtime QA proves its source cycle', () => {
    const root = createRoot();
    writeCapabilityArtifacts(root);
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      schema_version: 1,
      target: 'web',
      adapter: 'web-playwright',
      commands: { smoke: 'npm run smoke:row-reader' },
      flows: [{
        id: 'row-reader-return-session',
        path: 'tests/row-reader.spec.ts',
        verifies: ['resume a row-reading session without losing place'],
      }],
    }, null, 2));
    writeArtifact(root, '.omc/handoffs/runtime-qa/current.json', JSON.stringify({
      schema_version: 1,
      produced_at: '2026-04-25T00:00:00.000Z',
      agent_role: 'runtime-qa-runner',
      cycle_id: '2026-04-25-row-reader',
      status: 'passed',
      root,
      config_path: '.omc/runtime-qa.json',
      config_exists: true,
      adapter: 'web-playwright',
      auto: true,
      dry_run: false,
      artifact_dir: '.omc/artifacts/runtime-qa/test',
      step_results: [{ name: 'smoke', command: 'npm run smoke:row-reader', status: 'passed', reason: 'passed' }],
    }, null, 2));

    const report = generateProductScenarioCoverageAudit({ root });

    expect(report.status).toBe('covered');
    expect(report.scenarios[0]).toEqual(expect.objectContaining({
      capability_id: 'resume-a-row-reading-session-without-losing-plac',
      coverage: 'runtime-passed',
    }));
    expect(report.gaps).toEqual([]);
  });

  it('returns missing scenario gaps for completed work without executable user-loop evidence', () => {
    const root = createRoot();
    writeCapabilityArtifacts(root);

    const report = generateProductScenarioCoverageAudit({ root });

    expect(report.status).toBe('missing-scenarios');
    expect(report.scenarios[0]?.coverage).toBe('missing');
    expect(report.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining([
      'missing-scenario-coverage',
      'orphan-without-scenario-proof',
    ]));
  });

  it('writes JSON and markdown projections', () => {
    const root = createRoot();

    const written = writeProductScenarioCoverageAudit(root);

    expect(written.jsonPath).toContain(PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH);
    expect(written.mdPath).toContain(PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH);
    expect(existsSync(join(root, PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH))).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-scenario-coverage-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${content}\n`, 'utf-8');
}

function writeCapabilityArtifacts(root: string): void {
  writeArtifact(root, '.omc/cycles/2026-04-25-row-reader.json', JSON.stringify({
    schema_version: 1,
    cycle_id: '2026-04-25-row-reader',
    cycle_goal: 'ship row reader seed',
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
      core_product_slice: 'resume a row-reading session without losing place',
      enabling_task: 'persist project row state',
      learning_task: 'founder dogfood row-reading walkthrough',
    },
    spec: {
      acceptance_criteria: ['can increment and persist current row'],
      build_route: 'product-pipeline',
      verification_plan: ['runtime QA row-reader return-session smoke'],
      learning_plan: ['dogfood a sample pattern'],
      feature_expectation_contract: {
        user_job: 'continue a knitting pattern without losing place',
        first_meaningful_use: 'resume a row-reading session without losing place',
        useless_if: ['row value is isolated from pattern context'],
        maturity_ladder: {
          v0: 'manual row state persists',
          v1: 'remembers pattern context and return-session state',
          v2: 'coordinates row state with project history and mistake recovery',
        },
        not_done_until: ['users can resume without losing row context'],
      },
    },
    footer: {
      status: 'ok',
      evidence: ['fixture'],
      confidence: 0.7,
      blocking_issues: [],
      next_action: 'audit scenario coverage',
      artifacts_written: ['.omc/cycles/2026-04-25-row-reader.json'],
    },
    history: [{ stage: 'learn', at: '2026-04-25T00:00:00.000Z' }],
    updated_at: '2026-04-25T00:00:00.000Z',
  }, null, 2));
  writeArtifact(root, '.omc/learning/2026-04-25-row-reader.json', JSON.stringify({
    schema_version: 1,
    cycle_id: '2026-04-25-row-reader',
    shipped_outcome: 'Manual row state persists across return sessions.',
    evidence_collected: ['fixture'],
    user_product_learning: ['return-session context mattered more than a standalone counter'],
    invalidated_assumptions: ['a naked counter is enough'],
    recommended_next_cycle: 'deepen row reader with project history',
    next_candidate_adjustments: ['add v2 recovery depth'],
    footer: {
      status: 'ok',
      evidence: ['fixture'],
      confidence: 0.8,
      blocking_issues: [],
      next_action: 'run scenario coverage',
      artifacts_written: ['.omc/learning/2026-04-25-row-reader.json'],
    },
    captured_at: '2026-04-25T00:00:00.000Z',
  }, null, 2));
}

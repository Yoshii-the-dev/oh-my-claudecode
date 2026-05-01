import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
  PRODUCT_TOTALITY_MD_RELATIVE_PATH,
  generateProductTotalityAudit,
  writeProductTotalityAudit,
} from '../product-totality.js';
import {
  PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH,
  PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH,
} from '../capability-graph.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('generateProductTotalityAudit', () => {
  it('reports an empty product body when no completed cycles exist', () => {
    const root = createRoot();

    const report = generateProductTotalityAudit(root);

    expect(report.status).toBe('empty');
    expect(report.aggregates.completed_cycles).toBe(0);
    expect(report.gaps.map((gap) => gap.code)).toContain('no-completed-cycles');
    expect(report.next_action).toContain('Complete one product-cycle');
  });

  it('aggregates completed work and recommends missing maturity depth', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/2026-04-25-row-reader.json', JSON.stringify(cycleDocument(), null, 2));
    writeArtifact(root, '.omc/learning/2026-04-25-row-reader.json', JSON.stringify(learningDocument(), null, 2));
    writeArtifact(root, '.omc/portfolio/current.json', JSON.stringify(portfolioLedger(), null, 2));
    writeArtifact(root, '.omc/roadmap/current.md', 'v1 remembers pattern context and return-session state\nnot_done_until users can resume without losing row context\n');
    writeArtifact(root, '.omc/ecosystem/current.md', 'The reader connects to pattern import, row state, and project history.');
    writeArtifact(root, '.omc/meaning/current.md', 'Meaning hook: turn pattern following into calm progress.');
    writeArtifact(root, '.omc/design/visual-expectation/current.json', JSON.stringify({ desired_perception: 'calm focus' }));
    writeArtifact(root, '.omc/design/taste-gate/current.md', 'verdict: pass');

    const report = generateProductTotalityAudit(root);

    expect(report.aggregates.completed_cycles).toBe(1);
    expect(report.capabilities[0]?.maturity).toBe('contextual-v1');
    expect(report.capability_graph.aggregates.capability_count).toBe(1);
    expect(report.capability_graph.aggregates.edge_count).toBeGreaterThan(0);
    expect(report.capability_graph.orphan_capabilities).toEqual([]);
    expect(report.capabilities[0]?.connections).toEqual(expect.arrayContaining(['learning:.omc/learning/2026-04-25-row-reader.json', 'ecosystem', 'meaning']));
    expect(report.capabilities[0]?.missing_depth.some((entry) => entry.startsWith('v2:'))).toBe(true);
    expect(report.gaps.map((gap) => gap.code)).toContain('seeded-capability-needs-depth');
    expect(report.recommended_moves.some((move) => move.id.includes('v2'))).toBe(true);
  });

  it('flags orphan completed capabilities as graph-backed totality gaps', () => {
    const root = createRoot();
    const baseCycle = cycleDocument() as Record<string, unknown>;
    writeArtifact(root, '.omc/cycles/2026-04-25-naked-counter.json', JSON.stringify({
      ...baseCycle,
      cycle_id: '2026-04-25-naked-counter',
      cycle_goal: 'ship row counter',
      selected_portfolio: {
        core_product_slice: 'row counter',
        enabling_task: '',
        learning_task: '',
      },
      spec: {
        acceptance_criteria: ['button increments a number'],
        build_route: 'product-pipeline',
        verification_plan: ['npm test'],
        learning_plan: [],
      },
    }, null, 2));

    const report = generateProductTotalityAudit(root);

    expect(report.capability_graph.orphan_capabilities[0]).toEqual(expect.objectContaining({
      capability_id: 'row-counter',
      severity: 'error',
    }));
    expect(report.gaps.map((gap) => gap.code)).toContain('orphan-capability');
    expect(report.recommended_moves.map((move) => move.id)).toContain('row-counter-connect');
    expect(report.status).toBe('under-connected');
  });

  it('writes JSON and markdown projections', () => {
    const root = createRoot();

    const written = writeProductTotalityAudit(root);

    expect(written.jsonPath).toContain(PRODUCT_TOTALITY_JSON_RELATIVE_PATH);
    expect(written.mdPath).toContain(PRODUCT_TOTALITY_MD_RELATIVE_PATH);
    expect(written.capabilityGraphJsonPath).toContain(PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH);
    expect(written.capabilityGraphMdPath).toContain(PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH);
    expect(existsSync(join(root, PRODUCT_TOTALITY_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_TOTALITY_MD_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH))).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-product-totality-'));
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
      verification_plan: ['npm test'],
      learning_plan: ['dogfood a sample pattern'],
      experience_gate: '.omc/experience/current.md',
      feature_expectation_contract: {
        user_job: 'continue a knitting pattern without losing place',
        first_meaningful_use: 'open a pattern, track current row, close, and return later to the same row',
        useless_if: ['row value is isolated from pattern context', 'state is lost between sessions'],
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
      next_action: 'audit product totality',
      artifacts_written: ['.omc/cycles/2026-04-25-row-reader.json'],
    },
    history: [{ stage: 'learn', at: '2026-04-25T00:00:00.000Z' }],
    updated_at: '2026-04-25T00:00:00.000Z',
  };
}

function learningDocument(): unknown {
  return {
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
      next_action: 'run totality audit',
      artifacts_written: ['.omc/learning/2026-04-25-row-reader.json'],
    },
    captured_at: '2026-04-25T00:00:00.000Z',
  };
}

function portfolioLedger(): unknown {
  return {
    schema_version: 1,
    updated_at: '2026-04-25T00:00:00.000Z',
    source_artifacts: ['fixture'],
    items: [
      {
        id: 'row-reader-v1',
        title: 'row reader v1 remembers pattern context and return-session state',
        lane: 'product',
        status: 'selected',
        confidence: 'MEDIUM',
        dependencies: [],
        selected_cycle: '2026-04-25-row-reader',
        evidence: ['fixture'],
        type: 'core-product-slice',
        user_visible: true,
      },
      {
        id: 'row-state-storage',
        title: 'persist row state',
        lane: 'backend',
        status: 'done',
        confidence: 'HIGH',
        dependencies: [],
        selected_cycle: null,
        evidence: ['fixture'],
        type: 'enabling',
      },
    ],
  };
}

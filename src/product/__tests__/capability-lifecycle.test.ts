import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH,
  PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH,
  generateProductCapabilityLifecycleAudit,
  writeProductCapabilityLifecycleAudit,
} from '../capability-lifecycle.js';
import type { ProductRegressionReport } from '../product-regression.js';
import type { ProductScenarioCoverageReport } from '../scenario-coverage.js';
import type { ProductTotalityReport } from '../product-totality.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('generateProductCapabilityLifecycleAudit', () => {
  it('reports empty when no completed capabilities exist', () => {
    const root = createRoot();

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([]),
      scenarioCoverage: scenarioCoverageFixture([]),
      regression: regressionFixture([]),
      now: new Date('2026-04-25T00:00:00.000Z'),
    });

    expect(report.status).toBe('empty');
    expect(report.aggregates.capability_count).toBe(0);
  });

  it('marks declared but unrun capabilities as proving', () => {
    const root = createRoot();
    const capability = capabilityFixture({ id: 'row-reader', connections: ['learning:row-reader'], maturity: 'seeded-v0' });

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([capability]),
      scenarioCoverage: scenarioCoverageFixture([{ capability_id: 'row-reader', coverage: 'declared' }]),
      regression: regressionFixture([]),
    });

    expect(report.status).toBe('needs-proof');
    expect(report.capabilities[0]).toEqual(expect.objectContaining({
      capability_id: 'row-reader',
      stage: 'proving',
      decision: 'prove',
      scenario_coverage: 'declared',
    }));
  });

  it('marks isolated unproven capabilities as remove candidates', () => {
    const root = createRoot();
    const capability = capabilityFixture({
      id: 'naked-counter',
      title: 'naked counter',
      connections: [],
      missing_depth: ['v1: tie counter to pattern context'],
      maturity: 'seeded-v0',
    });

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([capability], { orphan: true }),
      scenarioCoverage: scenarioCoverageFixture([{ capability_id: 'naked-counter', coverage: 'missing' }]),
      regression: regressionFixture([{
        id: 'naked-counter-scenario-proof',
        severity: 'error',
        category: 'scenario-proof',
        subject: 'naked counter',
        message: 'Capability has no executable or declared scenario evidence.',
        recommended_action: 'Rewrite around a real return-session loop.',
        evidence: ['fixture'],
      }]),
    });

    expect(report.status).toBe('needs-triage');
    expect(report.capabilities[0]).toEqual(expect.objectContaining({
      stage: 'remove-candidate',
      decision: 'remove-or-redesign',
      orphan: true,
    }));
  });

  it('requires explicit lifecycle markers to be local to the capability', () => {
    const root = createRoot();
    const capability = capabilityFixture({
      id: 'row-reader',
      title: 'row reader',
      connections: ['learning:row-reader', 'roadmap'],
      missing_depth: ['v1: section-aware row tracking'],
      maturity: 'seeded-v0',
    });
    writeArtifact(root, '.omc/roadmap/current.md', `# Roadmap

## Cleanup
- Delete unrelated screenshot fixtures after visual QA.

## Product Depth
- Row reader needs section-aware depth before it is mature.
`);

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([capability]),
      scenarioCoverage: scenarioCoverageFixture([{ capability_id: 'row-reader', coverage: 'declared' }]),
      regression: regressionFixture([]),
    });

    expect(report.capabilities[0]?.stage).toBe('proving');
    expect(report.capabilities[0]?.reasons).not.toContain('roadmap or portfolio marks this capability for removal/rewrite');
  });

  it('honors explicit local remove markers for a capability', () => {
    const root = createRoot();
    const capability = capabilityFixture({
      id: 'row-reader',
      title: 'row reader',
      connections: ['learning:row-reader', 'roadmap'],
      missing_depth: ['v1: section-aware row tracking'],
      maturity: 'seeded-v0',
    });
    writeArtifact(root, '.omc/roadmap/current.md', `# Roadmap

## Carried Product Debt
- Remove-candidate: row reader. Remove, merge, or redesign this capability around a real user loop.
`);

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([capability]),
      scenarioCoverage: scenarioCoverageFixture([{ capability_id: 'row-reader', coverage: 'declared' }]),
      regression: regressionFixture([]),
    });

    expect(report.capabilities[0]?.stage).toBe('remove-candidate');
  });

  it('marks systemic capabilities with runtime proof as mature', () => {
    const root = createRoot();
    const capability = capabilityFixture({
      id: 'project-history',
      title: 'project history return session',
      maturity: 'systemic-v2',
      connections: ['learning:project-history', 'portfolio:project-history-depth', 'roadmap'],
      missing_depth: [],
    });

    const report = generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([capability]),
      scenarioCoverage: scenarioCoverageFixture([{ capability_id: 'project-history', coverage: 'runtime-passed' }]),
      regression: regressionFixture([]),
    });

    expect(report.status).toBe('healthy');
    expect(report.capabilities[0]).toEqual(expect.objectContaining({
      stage: 'mature',
      decision: 'retain',
      scenario_coverage: 'runtime-passed',
    }));
  });

  it('writes JSON and markdown projections', () => {
    const root = createRoot();

    const written = writeProductCapabilityLifecycleAudit(root, generateProductCapabilityLifecycleAudit({
      root,
      totality: totalityFixture([]),
      scenarioCoverage: scenarioCoverageFixture([]),
      regression: regressionFixture([]),
    }));

    expect(written.jsonPath).toContain(PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH);
    expect(written.mdPath).toContain(PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH);
    expect(existsSync(join(root, PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH))).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-capability-lifecycle-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function capabilityFixture(
  overrides: Partial<ProductTotalityReport['capabilities'][number]> = {},
): ProductTotalityReport['capabilities'][number] {
  return {
    id: 'row-reader',
    title: 'resume row reader return session',
    source_cycle: '2026-04-25-row-reader',
    source_path: '.omc/cycles/current.json',
    maturity: 'seeded-v0',
    user_job: 'continue knitting without losing place',
    first_meaningful_use: 'open pattern, advance row, return next session',
    implemented_as: 'row reader',
    missing_depth: ['v1: tie row state to pattern context'],
    connections: ['learning:row-reader'],
    evidence: ['fixture'],
    risks: [],
    ...overrides,
  };
}

function totalityFixture(
  capabilities: ProductTotalityReport['capabilities'],
  options: { orphan?: boolean } = {},
): ProductTotalityReport {
  return {
    schema_version: 1,
    generated_at: '2026-04-25T00:00:00.000Z',
    root: '/tmp/test',
    status: capabilities.length > 0 ? 'needs-depth' : 'empty',
    source_artifacts: ['.omc/cycles/current.json'],
    aggregates: {
      completed_cycles: capabilities.length,
      learning_captures: capabilities.length,
      seeded_capabilities: capabilities.length,
      supporting_systems: capabilities.length,
      portfolio_items: 0,
      active_or_selected_items: 0,
      lanes: [],
    },
    scores: {
      composition: score(),
      connectedness: score(),
      freedom: score(),
      depth: score(),
      complexity_fit: score(),
      beauty_fit: score(),
    },
    capability_graph: {
      aggregates: {
        capability_count: capabilities.length,
        context_node_count: 0,
        edge_count: 0,
        capability_edge_count: 0,
        orphan_count: options.orphan && capabilities[0] ? 1 : 0,
        isolated_capability_count: options.orphan && capabilities[0] ? 1 : 0,
        average_capability_degree: 0,
        missing_depth_count: capabilities.reduce((sum, capability) => sum + capability.missing_depth.length, 0),
      },
      nodes: [],
      edges: [],
      orphan_capabilities: options.orphan && capabilities[0]
        ? [{
            capability_id: capabilities[0].id,
            title: capabilities[0].title,
            severity: 'error',
            score: 0.9,
            reasons: ['isolated unproven capability'],
            recommended_action: 'Remove or redesign around a real user loop.',
            evidence: ['fixture'],
          }]
        : [],
    },
    capabilities,
    gaps: [],
    recommended_moves: [],
    next_action: 'next',
  };
}

function scenarioCoverageFixture(
  scenarios: Array<{ capability_id: string; coverage: ProductScenarioCoverageReport['scenarios'][number]['coverage'] }>,
): ProductScenarioCoverageReport {
  return {
    schema_version: 1,
    generated_at: '2026-04-25T00:00:00.000Z',
    root: '/tmp/test',
    status: scenarios.every((scenario) => scenario.coverage === 'runtime-passed') ? 'covered' : 'needs-runtime-evidence',
    source_artifacts: ['.omc/product/scenarios/current.json'],
    aggregates: {
      capability_count: scenarios.length,
      scenario_count: scenarios.length,
      covered_scenarios: scenarios.filter((scenario) => scenario.coverage === 'runtime-passed').length,
      declared_scenarios: scenarios.filter((scenario) => scenario.coverage === 'declared').length,
      missing_scenarios: scenarios.filter((scenario) => scenario.coverage === 'missing').length,
      failing_scenarios: 0,
      stale_scenarios: 0,
      runtime_qa_configured: false,
      runtime_qa_handoff_exists: false,
    },
    scenarios: scenarios.map((scenario) => ({
      id: `${scenario.capability_id}-scenario`,
      capability_id: scenario.capability_id,
      capability_title: scenario.capability_id,
      expected_user_loop: 'return session proof',
      source_cycle: '2026-04-25-row-reader',
      coverage: scenario.coverage,
      evidence: ['fixture'],
      gaps: [],
      recommended_action: 'Run runtime QA for this capability.',
    })),
    gaps: [],
    next_action: 'next',
  };
}

function regressionFixture(debts: ProductRegressionReport['debts']): ProductRegressionReport {
  return {
    schema_version: 1,
    generated_at: '2026-04-25T00:00:00.000Z',
    root: '/tmp/test',
    status: debts.length > 0 ? 'needs-repair' : 'stable',
    source_artifacts: ['.omc/product/scenario-coverage/current.json'],
    aggregates: {
      cycles: 1,
      completed_cycles: 1,
      regression_debts: debts.length,
      error_debts: debts.filter((debt) => debt.severity === 'error').length,
      warning_debts: debts.filter((debt) => debt.severity === 'warning').length,
      scenario_proof_debts: debts.filter((debt) => debt.category === 'scenario-proof').length,
      learning_debts: debts.filter((debt) => debt.category === 'learning').length,
    },
    debts,
    next_action: 'next',
  };
}

function score(): ProductTotalityReport['scores']['composition'] {
  return {
    value: 0.5,
    status: 'warn',
    detail: 'fixture',
  };
}

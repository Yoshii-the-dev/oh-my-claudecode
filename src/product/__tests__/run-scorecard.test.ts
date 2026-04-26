import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateRunScorecard } from '../run-scorecard.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('generateRunScorecard', () => {
  it('computes quality metrics from .omc artifacts', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/handoffs/2026-04-01-product.md', `
status: accepted
handoff: product-pipeline
evidence: fixture
confidence: high
`);
    writeArtifact(root, '.omc/handoffs/2026-04-02-backend.md', `
status: revise
handoff: backend-pipeline
rework required
`);
    writeArtifact(root, '.omc/cycles/2026-04-01-first.md', `
# Product Cycle
cycle_stage: discover
evidence: fixture
confidence: medium
`);
    writeArtifact(root, '.omc/learning/2026-04-05-first.md', `
# Learning
## Shipped outcome
First usable loop shipped.
evidence: fixture
confidence: high
`);
    writeArtifact(root, '.omc/opportunities/current.md', `
# Opportunities
core product slice
enabling task
learning/research task
product-pipeline
backend
design partner
evidence: fixture
confidence: medium
`);
    writeArtifact(root, '.omc/decisions/2026-04-03-tech.md', `
# Decision
technology-strategist
evidence:
  - fixture
confidence: 0.8
`);
    writeArtifact(root, '.omc/strategy/2026-04-04-risk.md', `
# Strategy
Assuming users want this. Low confidence.
`);

    const report = generateRunScorecard(root);

    expect(report.totals.artifacts).toBe(7);
    expect(report.totals.handoffs).toBe(2);
    expect(report.metrics.downstreamAcceptedWithoutReworkRate.value).toBe(0.5);
    expect(report.metrics.reworkRate.value).toBe(0.5);
    expect(report.metrics.evidenceConfidenceCoverage.value).toBeCloseTo(0.75);
    expect(report.metrics.researchInsteadOfInventionRate.value).toBeCloseTo(0.5);
    expect(report.metrics.timeToFirstUsableLoopDays.value).toBe(4);
    expect(report.evidence.reworkSignals).toContain('.omc/handoffs/2026-04-02-backend.md');
  });

  it('returns unknown metrics when .omc is absent', () => {
    const root = createRoot();

    const report = generateRunScorecard(root);

    expect(report.totals.artifacts).toBe(0);
    expect(report.metrics.downstreamAcceptedWithoutReworkRate.status).toBe('unknown');
    expect(report.metrics.timeToFirstUsableLoopDays.status).toBe('unknown');
  });

  it('prefers typed JSON artifacts over markdown projections', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/portfolio/current.json', JSON.stringify({
      schema_version: 1,
      updated_at: '2026-04-01T00:00:00.000Z',
      source_artifacts: ['fixture'],
      items: [
        {
          id: 'core-loop',
          title: 'Core loop',
          lane: 'product',
          status: 'selected',
          confidence: 'LOW',
          dependencies: [],
          selected_cycle: '2026-04-01-loop',
          evidence: ['fixture'],
          type: 'core-product-slice',
          user_visible: true,
        },
        {
          id: 'learning',
          title: 'Learning',
          lane: 'research',
          status: 'selected',
          confidence: 'HIGH',
          dependencies: [],
          selected_cycle: '2026-04-01-loop',
          evidence: ['fixture'],
          type: 'learning',
        },
      ],
    }));
    writeArtifact(root, '.omc/portfolio/current.md', `
# Stale projection
backend infrastructure only
no evidence
`);
    writeArtifact(root, '.omc/cycles/current.json', JSON.stringify({
      schema_version: 1,
      cycle_id: '2026-04-01-loop',
      cycle_goal: 'ship loop',
      cycle_stage: 'complete',
      spec: { build_route: 'product-pipeline' },
      footer: { evidence: ['fixture'], confidence: 0.8 },
    }));
    writeArtifact(root, '.omc/cycles/current.md', `
# stale cycle
cycle_stage: discover
backend
`);

    const report = generateRunScorecard(root);

    expect(report.totals.artifacts).toBe(2);
    expect(report.evidence.userVisibleWork).toEqual(expect.arrayContaining(['.omc/cycles/current.json', '.omc/portfolio/current.json']));
    expect(report.evidence.infrastructureWork).toEqual([]);
    expect(report.evidence.firstUsableLoopSignals).toContain('.omc/cycles/current.json');
    expect(report.metrics.evidenceConfidenceCoverage.value).toBe(1);
    expect(report.metrics.researchInsteadOfInventionRate.value).toBe(0.5);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-run-scorecard-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

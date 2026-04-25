import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateOpportunitiesToPortfolioLedger,
  renderPortfolioProjection,
  validatePortfolioLedger,
  writePortfolioProjection,
  type PortfolioLedger,
} from '../portfolio-ledger.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('portfolio ledger', () => {
  it('validates a compact work-item ledger and renders a markdown projection', () => {
    const root = createRoot();
    writeLedger(root, ledger());

    const report = validatePortfolioLedger(root);
    const projection = renderPortfolioProjection(report.ledger!);

    expect(report.ok).toBe(true);
    expect(report.summary.items).toBe(20);
    expect(report.summary.selected).toBe(3);
    expect(report.summary.lanes).toBe(7);
    expect(projection).toContain('| move-1 | product | selected | HIGH | 2026-04-25-first-loop |');
  });

  it('flags invalid ids, duplicate ids, invalid confidence, and missing evidence', () => {
    const root = createRoot();
    const broken = ledger();
    broken.items[1].id = 'move-1';
    broken.items[2].id = 'Invalid ID';
    broken.items[3].confidence = 2;
    broken.items[4].evidence = [];
    writeLedger(root, broken);

    const report = validatePortfolioLedger(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'duplicate-id',
      'invalid-id',
      'invalid-confidence',
      'missing-evidence',
    ]));
  });

  it('writes the human-readable current.md projection', () => {
    const root = createRoot();
    writeLedger(root, ledger());

    const path = writePortfolioProjection(root);

    expect(path).toBe(join(root, '.omc/portfolio/current.md'));
    expect(readFileSync(path, 'utf-8')).toContain('# Portfolio Ledger');
  });

  it('migrates legacy opportunities markdown into the portfolio ledger', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/opportunities/current.md', opportunitiesArtifact());

    const report = migrateOpportunitiesToPortfolioLedger(root, {
      now: '2026-04-25T00:00:00.000Z',
    });

    expect(report.ok).toBe(true);
    expect(report.wrote).toBe(false);
    expect(report.ledger?.items).toHaveLength(20);
    expect(report.ledger?.items.filter((item) => item.selected_cycle === '2026-04-25-migrated-portfolio')).toHaveLength(3);
    expect(report.ledger?.items[0]).toMatchObject({
      id: 'first-reader-loop',
      lane: 'product',
      status: 'selected',
      type: 'core-product-slice',
    });
  });

  it('writes migrated ledger and refuses to overwrite without force', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/opportunities/current.md', opportunitiesArtifact());

    const first = migrateOpportunitiesToPortfolioLedger(root, {
      write: true,
      now: '2026-04-25T00:00:00.000Z',
    });
    const second = migrateOpportunitiesToPortfolioLedger(root, {
      write: true,
      now: '2026-04-25T00:00:00.000Z',
    });

    expect(first.ok).toBe(true);
    expect(first.projectionPath).toBe(join(root, '.omc/portfolio/current.md'));
    expect(readFileSync(join(root, '.omc/portfolio/current.json'), 'utf-8')).toContain('"id": "first-reader-loop"');
    expect(second.ok).toBe(false);
    expect(second.issues.map((issue) => issue.code)).toContain('ledger-exists');
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-portfolio-ledger-'));
  rootsToClean.push(root);
  return root;
}

function writeLedger(root: string, data: PortfolioLedger): void {
  writeArtifact(root, '.omc/portfolio/current.json', `${JSON.stringify(data, null, 2)}\n`);
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function ledger(): PortfolioLedger {
  const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'] as const;
  const selectedCycle = '2026-04-25-first-loop';
  return {
    schema_version: 1,
    updated_at: '2026-04-25T00:00:00.000Z',
    source_artifacts: ['.omc/product/capability-map/current.md'],
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `move-${index + 1}`,
      title: index === 0 ? 'First reader loop' : `Move ${index + 1}`,
      lane: lanes[index % lanes.length],
      type: index === 0 ? 'core-product-slice' : index === 1 ? 'enabling' : index === 2 ? 'learning' : 'quality',
      status: index < 3 ? 'selected' : 'candidate',
      user_visible: index === 0,
      confidence: index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW',
      dependencies: index === 1 ? ['move-1'] : [],
      selected_cycle: index < 3 ? selectedCycle : null,
      evidence: ['fixture'],
      expected_learning: 'Fixture learning',
      dependency_unlock: 'Fixture unlock',
    })),
  };
}

function opportunitiesArtifact(): string {
  const lanes = ['product', 'backend', 'research', 'ux', 'quality', 'brand-content', 'distribution'];
  const rows = Array.from({ length: 20 }, (_, index) => {
    const id = index === 0 ? 'first-reader-loop' : index === 1 ? 'progress-storage' : index === 2 ? 'design-partner-session' : `move-${index + 1}`;
    const title = index === 0 ? 'First reader loop' : index === 1 ? 'Progress storage' : index === 2 ? 'Design partner session' : `Move ${index + 1}`;
    const lane = lanes[index % lanes.length];
    const confidence = index % 2 === 0 ? 'HIGH' : 'MEDIUM';
    return `| ${id} | ${title} | ${lane} | fixture evidence | ${confidence} | Fixture learning |`;
  }).join('\n');

  return `# Opportunities

| ID | Title | Lane | Evidence | Confidence | Expected learning |
| --- | --- | --- | --- | --- | --- |
${rows}

## Selected Cycle Portfolio
- 1 core product slice: First reader loop
- 1 enabling task: Progress storage
- 1 learning/research task: Design partner session

status: ok
evidence: fixture
confidence: medium
blocking_issues: none
next_action: migrate portfolio
artifacts_written: .omc/opportunities/current.md
`;
}

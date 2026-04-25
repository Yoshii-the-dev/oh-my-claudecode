import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  portfolioMigrateCommand,
  portfolioProjectCommand,
  portfolioValidateCommand,
} from '../commands/portfolio.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('portfolio CLI commands', () => {
  it('returns non-zero when the ledger is missing', async () => {
    const root = createRoot();
    const logger = captureLogger();

    const exitCode = await portfolioValidateCommand(root, {}, logger);

    expect(exitCode).toBe(1);
    expect(logger.logs.join('\n')).toContain('missing-ledger');
  });

  it('validates a ledger and writes the projection', async () => {
    const root = createRoot();
    writeLedger(root);
    const logger = captureLogger();

    const validateExit = await portfolioValidateCommand(root, {}, logger);
    const projectExit = await portfolioProjectCommand(root, { write: true }, logger);

    expect(validateExit).toBe(0);
    expect(projectExit).toBe(0);
    expect(logger.logs.join('\n')).toContain('Pass');
    expect(logger.logs.join('\n')).toContain(join(root, '.omc/portfolio/current.md'));
  });

  it('migrates opportunities markdown into a written ledger', async () => {
    const root = createRoot();
    writeArtifact(root, '.omc/opportunities/current.md', opportunitiesArtifact());
    const logger = captureLogger();

    const exitCode = await portfolioMigrateCommand(root, { write: true }, logger);

    expect(exitCode).toBe(0);
    expect(logger.logs.join('\n')).toContain('Wrote migrated portfolio ledger');
    expect(logger.logs.join('\n')).toContain(join(root, '.omc/portfolio/current.json'));
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-portfolio-cli-'));
  rootsToClean.push(root);
  return root;
}

function captureLogger(): { logs: string[]; errors: string[]; log: (message?: unknown) => void; error: (message?: unknown) => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message?: unknown) => logs.push(String(message ?? '')),
    error: (message?: unknown) => errors.push(String(message ?? '')),
  };
}

function writeLedger(root: string): void {
  const lanes = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution'];
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: `move-${index + 1}`,
    title: `Move ${index + 1}`,
    lane: lanes[index % lanes.length],
    type: index === 0 ? 'core-product-slice' : index === 1 ? 'enabling' : index === 2 ? 'learning' : 'quality',
    status: index < 3 ? 'selected' : 'candidate',
    user_visible: index === 0,
    confidence: index % 2 === 0 ? 'HIGH' : 'MEDIUM',
    dependencies: index === 1 ? ['move-1'] : [],
    selected_cycle: index < 3 ? '2026-04-25-first-loop' : null,
    evidence: ['fixture'],
    expected_learning: 'Fixture learning',
    dependency_unlock: 'Fixture unlock',
  }));
  writeArtifact(root, '.omc/portfolio/current.json', `${JSON.stringify({
    schema_version: 1,
    updated_at: '2026-04-25T00:00:00.000Z',
    source_artifacts: ['.omc/product/capability-map/current.md'],
    items,
  }, null, 2)}\n`);
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function opportunitiesArtifact(): string {
  const lanes = ['product', 'backend', 'research', 'ux', 'quality', 'brand-content', 'distribution'];
  const rows = Array.from({ length: 20 }, (_, index) => {
    const id = index === 0 ? 'first-reader-loop' : index === 1 ? 'progress-storage' : index === 2 ? 'design-partner-session' : `move-${index + 1}`;
    const title = index === 0 ? 'First reader loop' : index === 1 ? 'Progress storage' : index === 2 ? 'Design partner session' : `Move ${index + 1}`;
    return `| ${id} | ${title} | ${lanes[index % lanes.length]} | fixture | HIGH | learning |`;
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

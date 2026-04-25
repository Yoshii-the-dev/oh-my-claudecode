import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateCycleMarkdownToJson,
  parseCycleMarkdown,
  readCycleDocument,
  renderCycleProjection,
  validateCycleDocument,
  writeCycleDocument,
  type CycleDocument,
} from '../cycle-document.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('cycle-document', () => {
  it('parses canonical cycle markdown into a typed document', () => {
    const document = parseCycleMarkdown(sampleCycleMarkdown(), '2026-04-26T12:00:00Z');

    expect(document.schema_version).toBe(1);
    expect(document.cycle_id).toBe('2026-04-25-first-loop');
    expect(document.cycle_stage).toBe('spec');
    expect(document.spec.build_route).toBe('product-pipeline');
    expect(document.selected_portfolio.core_product_slice).toContain('row track');
    expect(document.spec.acceptance_criteria).toContain('user can resume the next row after reopening the app');
    expect(document.footer.evidence).toContain('fixture');
    expect(document.footer.confidence).toBe(0.6);
    expect(document.stage_checklist.spec).toBe(false);
    expect(document.stage_checklist.discover).toBe(true);
  });

  it('migrates markdown to a json document and projects it back', () => {
    const root = createRoot();
    writeFile(root, '.omc/cycles/current.md', sampleCycleMarkdown());

    const report = migrateCycleMarkdownToJson(root, { write: true, now: '2026-04-26T12:00:00Z' });

    expect(report.ok).toBe(true);
    expect(existsSync(join(root, '.omc/cycles/current.json'))).toBe(true);
    expect(existsSync(join(root, '.omc/cycles/current.md'))).toBe(true);
    const persisted = readCycleDocument(root);
    expect(persisted?.cycle_stage).toBe('spec');
    expect(persisted?.spec.acceptance_criteria.length).toBeGreaterThan(0);

    const projection = readFileSync(join(root, '.omc/cycles/current.md'), 'utf-8');
    expect(projection).toContain('schema_source: .omc/cycles/current.json');
    expect(projection).toContain('## Stage Checklist');
    expect(projection).toContain('build_route: product-pipeline');
  });

  it('validates a written document and rejects malformed JSON', () => {
    const root = createRoot();
    writeFile(root, '.omc/cycles/current.json', '{not valid json');

    const report = validateCycleDocument(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('invalid-json');
  });

  it('refuses to overwrite an existing json without --force', () => {
    const root = createRoot();
    writeFile(root, '.omc/cycles/current.md', sampleCycleMarkdown());
    writeFile(root, '.omc/cycles/current.json', '{}');

    const report = migrateCycleMarkdownToJson(root, { write: true });

    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('json-exists');
  });

  it('round-trips through writeCycleDocument and readCycleDocument', () => {
    const root = createRoot();
    const sample: CycleDocument = parseCycleMarkdown(sampleCycleMarkdown(), '2026-04-26T12:00:00Z');
    writeCycleDocument(root, sample);

    const loaded = readCycleDocument(root);
    expect(loaded?.cycle_id).toBe(sample.cycle_id);
    expect(renderCycleProjection(loaded as CycleDocument)).toContain('cycle_stage: spec');
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-cycle-doc-'));
  rootsToClean.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function sampleCycleMarkdown(): string {
  return `# Product Cycle: ship first usable loop

cycle_id: 2026-04-25-first-loop
cycle_goal: ship first usable loop
cycle_stage: spec
product_stage: pre-mvp

## Stage Checklist
- [x] discover
- [x] rank
- [x] select
- [ ] spec
- [ ] build
- [ ] verify
- [ ] learn

## Selected Cycle Portfolio
core_product_slice: import/open sample pattern -> row track -> persist progress -> resume next session
enabling_task: local progress persistence
learning_task: design partner row-tracking session

## Cycle Spec
acceptance_criteria:
  - user can resume the next row after reopening the app
build_route: product-pipeline
verification_plan:
  - npm test
learning_plan:
  - observe one design partner using the reader loop
experience_gate: .omc/experience/current.md

status: ok
evidence:
  - fixture
confidence: 0.6
blocking_issues:
  - []
next_action: start product-pipeline
artifacts_written:
  - .omc/cycles/current.md
`;
}

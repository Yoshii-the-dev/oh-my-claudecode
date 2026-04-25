import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateLearningMarkdownToJson,
  parseLearningMarkdown,
  readLearningDocument,
  validateLearningDocument,
  writeLearningDocument,
  type LearningDocument,
} from '../learning-document.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('learning-document', () => {
  it('parses canonical learning markdown into a typed document', () => {
    const document = parseLearningMarkdown(sampleLearningMarkdown(), { now: '2026-04-30T12:00:00Z', cycleId: '2026-04-25-first-loop' });

    expect(document.schema_version).toBe(1);
    expect(document.cycle_id).toBe('2026-04-25-first-loop');
    expect(document.shipped_outcome).toContain('First usable loop');
    expect(document.evidence_collected).toContain('Two design partners completed the loop');
    expect(document.invalidated_assumptions.length).toBeGreaterThan(0);
    expect(document.recommended_next_cycle).toContain('resume telemetry');
    expect(document.footer.confidence).toBe(0.7);
  });

  it('migrates markdown to a json document and writes a projection', () => {
    const root = createRoot();
    writeFile(root, '.omc/learning/current.md', sampleLearningMarkdown());

    const report = migrateLearningMarkdownToJson(root, { write: true, now: '2026-04-30T12:00:00Z', cycleId: '2026-04-25-first-loop' });

    expect(report.ok).toBe(true);
    expect(existsSync(join(root, '.omc/learning/current.json'))).toBe(true);
    expect(existsSync(join(root, '.omc/learning/current.md'))).toBe(true);
    const projection = readFileSync(join(root, '.omc/learning/current.md'), 'utf-8');
    expect(projection).toContain('schema_source: .omc/learning/current.json');
    expect(projection).toContain('## Shipped outcome');
  });

  it('rejects empty shipped outcome at validation time', () => {
    const root = createRoot();
    const document: LearningDocument = {
      schema_version: 1,
      cycle_id: '2026-04-25-first-loop',
      shipped_outcome: '',
      evidence_collected: ['observed two users'],
      user_product_learning: ['resume-on-row was loved'],
      invalidated_assumptions: [],
      recommended_next_cycle: 'next telemetry cycle',
      next_candidate_adjustments: [],
      footer: { status: 'ok', evidence: ['fixture'], confidence: 0.7, blocking_issues: [], next_action: 'start next cycle', artifacts_written: ['.omc/learning/current.md'] },
      captured_at: '2026-04-30T12:00:00Z',
    };
    writeLearningDocument(root, document);

    const report = validateLearningDocument(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain('missing-shipped-outcome');
  });

  it('round-trips through writeLearningDocument and readLearningDocument', () => {
    const root = createRoot();
    const document = parseLearningMarkdown(sampleLearningMarkdown(), { now: '2026-04-30T12:00:00Z', cycleId: '2026-04-25-first-loop' });
    writeLearningDocument(root, document);

    const loaded = readLearningDocument(root);
    expect(loaded?.cycle_id).toBe('2026-04-25-first-loop');
    expect(loaded?.evidence_collected.length).toBeGreaterThan(0);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-learning-doc-'));
  rootsToClean.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function sampleLearningMarkdown(): string {
  return `# Learning: 2026-04-25-first-loop

cycle_id: 2026-04-25-first-loop

## Shipped outcome
First usable loop shipped after 5 days.

## Evidence collected
- Two design partners completed the loop
- Resume-on-row used 3 sessions in a row

## User/product learning
- Resume-on-row is the highest-value affordance for empty pre-MVP

## Invalidated assumptions
- Users do not need a built-in chart editor in week 1
- A landing page is not blocking activation

## Recommended next cycle
Iterate on resume telemetry to inform retention loop.

## Next candidate adjustments
- Add row-tracker undo
- Improve session-resume hint

status: ok
evidence:
  - fixture
confidence: 0.7
blocking_issues:
  - []
next_action: start next cycle
artifacts_written:
  - .omc/learning/current.md
`;
}

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREATIVE_LOOP_JSON_RELATIVE_PATH,
  CREATIVE_LOOP_MD_RELATIVE_PATH,
  VISUAL_LIFECYCLE_JSON_RELATIVE_PATH,
  VISUAL_LIFECYCLE_MD_RELATIVE_PATH,
  generateVisualLifecycleReport,
  initCreativeLoop,
  planCreativeLoop,
  renderCreativeLoopPlan,
  writeCreativeLoopPlan,
  writeVisualLifecycleReport,
} from '../creative-loop.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('creative loop', () => {
  it('reports needs-brief when required artifacts are missing', () => {
    const root = createRoot();

    const plan = planCreativeLoop({ root, goal: 'distinct onboarding' });

    expect(plan.status).toBe('needs-brief');
    expect(plan.missing_required).toContain('meaning-brief');
    expect(plan.recommended_commands[0]).toContain('--phase brief');
  });

  it('initializes draft artifacts and writes the creative-loop plan', () => {
    const root = createRoot();

    const plan = initCreativeLoop({ root, goal: 'row tracking dashboard' });

    expect(plan.status).toBe('needs-brief');
    expect(plan.artifacts.find((artifact) => artifact.id === 'meaning-brief')?.reason).toBe('draft placeholder');
    expect(existsSync(join(root, '.omc/design/meaning-brief/current.md'))).toBe(true);
    expect(existsSync(join(root, '.omc/design/visual-expectation/current.json'))).toBe(true);
    expect(existsSync(join(root, '.omc/design/component-experiments/current.json'))).toBe(true);
    expect(existsSync(join(root, CREATIVE_LOOP_JSON_RELATIVE_PATH))).toBe(true);
    expect(existsSync(join(root, CREATIVE_LOOP_MD_RELATIVE_PATH))).toBe(true);
  });

  it('reports ready when the creative artifacts pass the minimum contracts', () => {
    const root = createRoot();
    writePassingCreativeLoop(root);

    const plan = planCreativeLoop({ root, goal: 'row tracking dashboard' });
    const written = writeCreativeLoopPlan(root, plan);
    const markdown = renderCreativeLoopPlan(plan);

    expect(plan.status).toBe('ready');
    expect(plan.missing_required).toEqual([]);
    expect(written.jsonPath).toContain(CREATIVE_LOOP_JSON_RELATIVE_PATH);
    expect(markdown).toContain('status: ready');
    expect(markdown).toContain('.omc/design/taste-gate/current.md');
  });

  it('blocks readiness when visual evidence references missing screenshots', () => {
    const root = createRoot();
    writePassingCreativeLoop(root);
    rmSync(join(root, '.omc/artifacts/creative-loop/row-marker.png'));

    const plan = planCreativeLoop({ root, goal: 'row tracking dashboard' });

    expect(plan.status).toBe('needs-brief');
    expect(plan.artifacts.find((artifact) => artifact.id === 'visual-expectation')?.reason).toContain('screenshot');
    expect(plan.artifacts.find((artifact) => artifact.id === 'component-experiments')?.reason).toContain('screenshot');
  });

  it('classifies visual lifecycle from hypothesis through screenshot proof', () => {
    const root = createRoot();
    writePassingCreativeLoop(root);

    const report = generateVisualLifecycleReport({ root, goal: 'row tracking dashboard' });
    const written = writeVisualLifecycleReport(root, report);

    expect(report.status).toBe('healthy');
    expect(report.phases.map((phase) => [phase.id, phase.state])).toEqual([
      ['visual-hypothesis', 'ready'],
      ['implementation-mapping', 'ready'],
      ['screenshot-proof', 'ready'],
      ['iteration-debt', 'watchlist'],
    ]);
    expect(report.aggregates.screenshot_proofs).toBe(1);
    expect(report.debts.map((debt) => debt.phase)).toContain('iteration-debt');
    expect(written.jsonPath).toContain(VISUAL_LIFECYCLE_JSON_RELATIVE_PATH);
    expect(written.mdPath).toContain(VISUAL_LIFECYCLE_MD_RELATIVE_PATH);
  });

  it('marks visual lifecycle as screenshot-proof debt when screenshots are missing', () => {
    const root = createRoot();
    writePassingCreativeLoop(root);
    rmSync(join(root, '.omc/artifacts/creative-loop/row-marker.png'));

    const report = generateVisualLifecycleReport({ root, goal: 'row tracking dashboard' });

    expect(report.status).toBe('needs-screenshot-proof');
    expect(report.phases.find((phase) => phase.id === 'screenshot-proof')?.state).toBe('partial');
    expect(report.debts.some((debt) => debt.subject === 'visual-expectation')).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-creative-loop-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function writePassingCreativeLoop(root: string): void {
  writeArtifact(root, '.omc/artifacts/creative-loop/row-marker.png', 'fake screenshot');
  writeArtifact(root, '.omc/design/meaning-brief/current.md', [
    '# Meaning Brief',
    'Feeling: calm progress confidence.',
    'Understanding: the next action and saved state are obvious.',
    'User State: before uncertain, during focused, after confident.',
    'Product Meaning: row progress is a trusted companion.',
  ].join('\n'));
  writeArtifact(root, '.omc/design/inspiration-ledger/current.md', [
    '# Inspiration Ledger',
    '- source: craft workbench',
    '  - principle: tools stay close to the work surface.',
    '  - constraint: applies to primary row actions and project cards.',
    '  - what not to copy: skeuomorphic ornament.',
  ].join('\n'));
  writeArtifact(root, '.omc/design/visual-expectation/current.json', `${JSON.stringify({
    schema_version: 1,
    visual_expectation_contract: {
      desired_perception: ['calm progress confidence'],
      category_codes_to_avoid: ['generic spreadsheet tracker'],
      inspiration_principles: [{
        source: 'craft workbench',
        principle: 'tools stay close to the work surface',
        what_not_to_copy: 'literal skeuomorphic wood texture',
      }],
      selected_direction: {
        name: 'quiet ledger with tactile row markers',
        rationale: 'keeps the current row visually dominant without making the app feel like a spreadsheet',
        tradeoffs: 'less decorative than an editorial craft look, stronger for repeat use',
      },
      token_rationale: [
        { token: 'color.primary', decision: 'near-black primary controls', reason: 'maximum contrast for mid-knit tapping' },
        { token: 'spacing.4xl', decision: 'wide counter spacing', reason: 'keeps accidental taps low' },
      ],
      component_proofs: [{
        component: 'RowCounter',
        state: 'row saved',
        screenshot: '.omc/artifacts/creative-loop/row-marker.png',
        visual_verdict: 'pass',
      }],
      screenshot_evidence: ['.omc/artifacts/creative-loop/row-marker.png'],
      not_ready_if: ['the screen can pass implementation tests while reading as a generic counter'],
    },
  }, null, 2)}\n`);
  writeArtifact(root, '.omc/design/directions/current.md', [
    '# Directions',
    '## Direction 1',
    'hypothesis: quiet ledger with tactile row markers.',
    'tradeoff: less expressive, more durable for daily sessions.',
    '## Direction 2',
    'hypothesis: focused stage with progress rail.',
    'tradeoff: clearer sequence, more visual weight.',
    '## Direction 3',
    'hypothesis: compact dashboard with craft-coded status.',
    'tradeoff: dense scanning, weaker emotional feel.',
  ].join('\n'));
  writeArtifact(root, '.omc/design/motion-grammar/current.md', [
    '# Motion Grammar',
    '- state: row saved',
    '  - why: confirm persistence without stealing focus.',
    '  - duration: 160ms',
    '  - easing: ease-out',
    '  - reduced motion: static saved label.',
  ].join('\n'));
  writeArtifact(root, '.omc/design/tokens/current.json', `${JSON.stringify({
    color: { primary: '#111827' },
    type: { body: 16 },
    spacing: { md: 8 },
    radius: { card: 8 },
    elevation: { card: 1 },
    motion: { saved: '160ms ease-out' },
  }, null, 2)}\n`);
  writeArtifact(root, '.omc/design/component-experiments/current.json', `${JSON.stringify({
    experiment: ['row marker'],
    screenshot: ['.omc/artifacts/creative-loop/row-marker.png'],
    visual_verdict: ['pass'],
  }, null, 2)}\n`);
  writeArtifact(root, '.omc/design/taste-gate/current.md', [
    'verdict: pass',
    'Distinctiveness: passes with a craft-led workbench direction.',
    'Usability: passes because primary row action stays visible.',
    'Accessibility: passes with focus, contrast, and reduced motion notes.',
    'Brand Fit: passes because product meaning and visual language align.',
    'Evidence: screenshot .omc/artifacts/creative-loop/row-marker.png and visual verdict pass.',
  ].join('\n'));
}

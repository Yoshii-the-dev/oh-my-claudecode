import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CREATIVE_LOOP_JSON_RELATIVE_PATH, CREATIVE_LOOP_MD_RELATIVE_PATH, initCreativeLoop, planCreativeLoop, renderCreativeLoopPlan, writeCreativeLoopPlan, } from '../creative-loop.js';
let rootsToClean = [];
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
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-creative-loop-'));
    rootsToClean.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function writePassingCreativeLoop(root) {
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
        '  - what not to copy: skeuomorphic ornament.',
    ].join('\n'));
    writeArtifact(root, '.omc/design/directions/current.md', [
        '# Directions',
        '## Direction 1',
        'hypothesis: quiet ledger with tactile row markers.',
        '## Direction 2',
        'hypothesis: focused stage with progress rail.',
        '## Direction 3',
        'hypothesis: compact dashboard with craft-coded status.',
    ].join('\n'));
    writeArtifact(root, '.omc/design/motion-grammar/current.md', [
        '# Motion Grammar',
        '- state: row saved',
        '  - why: confirm persistence without stealing focus.',
        '  - duration: 160ms',
        '  - easing: ease-out',
    ].join('\n'));
    writeArtifact(root, '.omc/design/tokens/current.json', `${JSON.stringify({
        color: {},
        type: {},
        spacing: {},
        radius: {},
        motion: {},
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
    ].join('\n'));
}
//# sourceMappingURL=creative-loop.test.js.map
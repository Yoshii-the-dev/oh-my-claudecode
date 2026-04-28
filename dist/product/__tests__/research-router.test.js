import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { planProductResearch, scoreProductResearch } from '../research-router.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('scoreProductResearch', () => {
    it('scores user-facing visual work above threshold and explains matched signals', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/experience/current.md', [
            '# Experience',
            'The dashboard screen has empty state, error state, loading state, return session, visual chart, and accessibility requirements.',
        ].join('\n'));
        const snapshot = snapshotFor(root, {
            buildRoute: 'product-pipeline',
            cycleGoal: 'ship a visual onboarding dashboard',
        });
        const scorecard = scoreProductResearch({
            root,
            snapshot,
            stage: 'build',
            corpus: [
                snapshot.cycleGoal,
                snapshot.buildRoute,
                'dashboard screen empty state error state loading return session visual chart accessibility',
            ].join('\n').toLowerCase(),
        });
        const userScore = scorecard.scores.find((score) => score.routeId === 'user-interaction-research');
        expect(userScore?.selected).toBe(true);
        expect(userScore?.score).toBeGreaterThanOrEqual(userScore?.threshold ?? 999);
        expect(userScore?.reasons.join('\n')).toContain('user-facing-build-route');
        expect(scorecard.provisioningSurfaces).toEqual(['frontend-product', 'visual-creative']);
    });
    it('routes through provisioning before research when required surfaces are missing', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/current.md', [
            'cycle_id: 2026-04-28-score',
            'cycle_stage: build',
            'cycle_goal: ship visual dashboard',
            'build_route: product-pipeline',
            'acceptance_criteria: dashboard screen handles empty state and return session',
        ].join('\n'));
        writeArtifact(root, '.omc/experience/current.md', [
            '# Experience',
            'Dashboard screen with visual chart, empty state, error state, loading state, return session, and accessibility requirements.',
        ].join('\n'));
        const plan = planProductResearch({
            root,
            stage: 'build',
            snapshot: snapshotFor(root, {
                buildRoute: 'product-pipeline',
                cycleGoal: 'ship visual dashboard',
            }),
        });
        expect(plan.scorecard.selectedRouteIds).toContain('user-interaction-research');
        expect(plan.routes.map((route) => route.id)).toEqual([
            'research-skill-provisioning',
            'user-interaction-research',
        ]);
        expect(plan.routes[0]?.command).toContain('--surfaces=frontend-product,visual-creative');
        expect(plan.routes[1]?.trigger).toContain('score');
    });
    it('does not add provisioning when manifest already covers selected surfaces', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/provisioned/current.json', JSON.stringify({
            surfaces: ['frontend-product', 'visual-creative'],
        }));
        writeArtifact(root, '.omc/experience/current.md', [
            '# Experience',
            'Dashboard screen with visual chart, empty state, error state, loading state, return session, and accessibility requirements.',
        ].join('\n'));
        const plan = planProductResearch({
            root,
            stage: 'build',
            snapshot: snapshotFor(root, {
                buildRoute: 'product-pipeline',
                cycleGoal: 'ship visual dashboard',
            }),
        });
        expect(plan.routes.map((route) => route.id)).toEqual(['user-interaction-research']);
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-research-router-'));
    rootsToClean.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function snapshotFor(root, overrides) {
    return {
        exists: true,
        root,
        path: join(root, '.omc/cycles/current.md'),
        cycleId: '2026-04-28-score',
        cycleGoal: 'ship scored research route',
        stage: 'build',
        buildRoute: 'product-pipeline',
        nextAction: 'run product cycle',
        issues: [],
        ...overrides,
    };
}
//# sourceMappingURL=research-router.test.js.map
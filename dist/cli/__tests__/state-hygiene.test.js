import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { isOmcRuntimeStatePath, stateHygieneCommand, } from '../commands/state-hygiene.js';
let rootsToClean = [];
afterEach(() => {
    for (const root of rootsToClean) {
        rmSync(root, { recursive: true, force: true });
    }
    rootsToClean = [];
});
describe('state hygiene CLI command', () => {
    it('classifies runtime state without matching product artifacts', () => {
        expect(isOmcRuntimeStatePath('.omc/state/sessions/demo/hud-state.json')).toBe(true);
        expect(isOmcRuntimeStatePath('.omc/sessions/session.json')).toBe(true);
        expect(isOmcRuntimeStatePath('.omc/logs/team.log')).toBe(true);
        expect(isOmcRuntimeStatePath('.omc/project-memory.json')).toBe(true);
        expect(isOmcRuntimeStatePath('apps/mobile/.omc/state/last-tool-error.json')).toBe(true);
        expect(isOmcRuntimeStatePath('.omc/competitors/ios/.omc/state/replay.jsonl')).toBe(true);
        expect(isOmcRuntimeStatePath('.omc/portfolio/current.json')).toBe(false);
        expect(isOmcRuntimeStatePath('.omc/cycles/current.md')).toBe(false);
        expect(isOmcRuntimeStatePath('src/state/machine.ts')).toBe(false);
    });
    it('reports tracked runtime state without changing the git index by default', async () => {
        const root = createGitRoot();
        writeArtifact(root, '.omc/state/sessions/demo/hud-state.json', '{}\n');
        writeArtifact(root, '.omc/portfolio/current.json', '{}\n');
        writeArtifact(root, 'apps/mobile/.omc/state/last-tool-error.json', '{}\n');
        git(root, ['add', '.']);
        const logger = captureLogger();
        const exitCode = await stateHygieneCommand(root, { json: true }, logger);
        const report = JSON.parse(logger.logs.join('\n'));
        expect(exitCode).toBe(1);
        expect(report.trackedRuntimeFiles).toEqual([
            '.omc/state/sessions/demo/hud-state.json',
            'apps/mobile/.omc/state/last-tool-error.json',
        ]);
        expect(git(root, ['ls-files'])).toContain('.omc/state/sessions/demo/hud-state.json');
        expect(git(root, ['ls-files'])).toContain('.omc/portfolio/current.json');
    });
    it('untracks runtime state with --apply while keeping files on disk', async () => {
        const root = createGitRoot();
        writeArtifact(root, '.omc/project-memory.json', '{}\n');
        writeArtifact(root, '.omc/portfolio/current.json', '{}\n');
        writeArtifact(root, 'services/api/.omc/telemetry/run.json', '{}\n');
        git(root, ['add', '.']);
        const logger = captureLogger();
        const exitCode = await stateHygieneCommand(root, { apply: true, json: true }, logger);
        const report = JSON.parse(logger.logs.join('\n'));
        expect(exitCode).toBe(0);
        expect(report.ok).toBe(true);
        expect(report.applied).toBe(true);
        expect(report.trackedRuntimeFiles).toEqual([]);
        expect(git(root, ['ls-files'])).toBe('.omc/portfolio/current.json\n');
        expect(existsSync(join(root, '.omc/project-memory.json'))).toBe(true);
        expect(existsSync(join(root, 'services/api/.omc/telemetry/run.json'))).toBe(true);
    });
});
function createGitRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-state-hygiene-'));
    rootsToClean.push(root);
    git(root, ['init', '--quiet']);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function git(root, args) {
    return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
function captureLogger() {
    const logs = [];
    const errors = [];
    return {
        logs,
        errors,
        log: (message) => logs.push(String(message ?? '')),
        error: (message) => errors.push(String(message ?? '')),
    };
}
//# sourceMappingURL=state-hygiene.test.js.map
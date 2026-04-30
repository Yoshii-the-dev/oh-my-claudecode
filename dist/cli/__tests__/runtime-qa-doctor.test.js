import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeQaDoctorCommand } from '../commands/runtime-qa-doctor.js';
const roots = [];
afterEach(() => {
    for (const root of roots)
        rmSync(root, { recursive: true, force: true });
    roots.length = 0;
});
describe('runtime QA doctor command', () => {
    it('prints JSON diagnostics and returns non-zero for blocked evidence', async () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'project-script',
            adapter: 'project-script',
        }));
        const logger = captureLogger();
        const exitCode = await runtimeQaDoctorCommand(root, { json: true }, logger);
        const report = JSON.parse(logger.logs.join('\n'));
        expect(exitCode).toBe(1);
        expect(report.issues.map((issue) => issue.code)).toContain('runtime-qa-no-executable-commands');
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-runtime-qa-doctor-'));
    roots.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function captureLogger() {
    const logs = [];
    return {
        logs,
        log: (message) => logs.push(String(message ?? '')),
    };
}
//# sourceMappingURL=runtime-qa-doctor.test.js.map
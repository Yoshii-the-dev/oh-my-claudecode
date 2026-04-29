import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRuntimeQaConfig, runRuntimeQa, shouldRunRuntimeQa, writeRuntimeQaRunReport, } from '../runner.js';
const roots = [];
afterEach(() => {
    for (const root of roots)
        rmSync(root, { recursive: true, force: true });
    roots.length = 0;
});
describe('runtime QA runner', () => {
    it('runs configured project-script commands and writes compact evidence', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'project-script',
            commands: {
                build: 'npm run build',
                smoke: ['npm run smoke:a', 'npm run smoke:b'],
            },
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const report = runRuntimeQa({ root, auto: true, commandRunner });
        const written = writeRuntimeQaRunReport(root, report);
        expect(report.status).toBe('passed');
        expect(calls).toEqual(['npm run build', 'npm run smoke:a', 'npm run smoke:b']);
        expect(existsSync(written.jsonPath)).toBe(true);
        expect(JSON.parse(readFileSync(written.jsonPath, 'utf-8')).status).toBe('passed');
    });
    it('blocks web-playwright when no Playwright project or smoke command exists', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({ target: 'web', adapter: 'web-playwright' }));
        const report = runRuntimeQa({ root, auto: true, commandRunner: vi.fn() });
        expect(report.status).toBe('blocked');
        expect(report.install_proposal).toContain('Playwright');
    });
    it('detects mobile smoke declarations and missing mobile tooling', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: { smoke: 'maestro test .maestro/smoke.yaml' },
        }));
        const commandRunner = () => ({ status: 0, stdout: 'passed', stderr: '' });
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
            version: 'test',
        });
        const report = runRuntimeQa({ root, auto: true, commandRunner, toolDetector });
        expect(report.status).toBe('passed');
        expect(report.adapter).toBe('mobile-maestro');
    });
    it('blocks mobile runtime QA when the tool is missing and install was not approved', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-detox',
            commands: { smoke: 'detox test --configuration ios.sim.debug' },
        }));
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'test',
        });
        const report = runRuntimeQa({ root, auto: true, commandRunner: vi.fn(), toolDetector });
        expect(report.status).toBe('blocked');
        expect(report.install_proposal).toContain('--install-mobile-tools');
        expect(report.tool_detection?.detected).toBe(false);
    });
    it('installs missing mobile tooling when explicitly approved', () => {
        const root = createRoot();
        writeArtifact(root, 'package.json', JSON.stringify({ scripts: { e2e: 'detox test --configuration ios.sim.debug' } }));
        writeArtifact(root, 'pnpm-lock.yaml', '');
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-detox',
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'test',
        });
        const report = runRuntimeQa({
            root,
            auto: true,
            installMobileTools: true,
            commandRunner,
            toolDetector,
        });
        expect(report.status).toBe('passed');
        expect(calls).toEqual(['pnpm add detox --save-dev', 'pnpm run e2e']);
        expect(report.step_results[0]?.name).toBe('install-detox');
    });
    it('uses the official npm global install route for Appium by default', () => {
        const root = createRoot();
        writeArtifact(root, 'package.json', JSON.stringify({ scripts: { 'appium:test': 'appium --version' } }));
        writeArtifact(root, 'pnpm-lock.yaml', '');
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-appium',
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'test',
        });
        const report = runRuntimeQa({
            root,
            auto: true,
            installMobileTools: true,
            commandRunner,
            toolDetector,
        });
        expect(report.status).toBe('passed');
        expect(calls[0]).toBe('npm i --location=global appium');
    });
    it('uses cycle verification signals to decide runtime QA should run', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/current.md', 'verification_plan:\n  - simulator smoke on iOS\n');
        expect(shouldRunRuntimeQa(root)).toBe(true);
    });
    it('blocks simulator verification when cycle asks for mobile smoke but no config or command exists', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/current.md', 'verification_plan:\n  - iOS simulator smoke\n');
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'test',
        });
        const report = runRuntimeQa({ root, auto: true, toolDetector, commandRunner: vi.fn() });
        expect(report.status).toBe('blocked');
        expect(report.config_exists).toBe(false);
        expect(report.adapter).toBe('mobile-maestro');
        expect(report.install_proposal).toContain('commands.smoke');
    });
    it('initializes runtime QA config from detected mobile scripts', () => {
        const root = createRoot();
        writeArtifact(root, 'package.json', JSON.stringify({
            scripts: { 'detox:test': 'detox test --configuration ios.sim.debug' },
        }));
        const result = initRuntimeQaConfig({ root, target: 'mobile', write: true });
        expect(result.written).toBe(true);
        expect(result.config.adapter).toBe('mobile-detox');
        expect(result.config.commands?.smoke).toBe('npm run detox:test');
        expect(existsSync(result.path)).toBe(true);
    });
});
function createRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-runtime-qa-'));
    roots.push(root);
    return root;
}
function writeArtifact(root, relativePath, content) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
//# sourceMappingURL=runner.test.js.map
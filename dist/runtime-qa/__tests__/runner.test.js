import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRuntimeQaConfig, migrateRuntimeQaConfig, runRuntimeQa, shouldRunRuntimeQa, writeRuntimeQaRunReport, } from '../runner.js';
const roots = [];
afterEach(() => {
    for (const root of roots)
        rmSync(root, { recursive: true, force: true });
    roots.length = 0;
});
describe('runtime QA runner', () => {
    it('runs configured project-script commands and writes compact evidence', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/cycles/current.md', 'cycle_id: 2026-04-30-runtime-qa\ncycle_stage: verify\n');
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
        expect(report.cycle_id).toBe('2026-04-30-runtime-qa');
        expect(calls).toEqual(['npm run build', 'npm run smoke:a', 'npm run smoke:b']);
        expect(existsSync(written.jsonPath)).toBe(true);
        expect(JSON.parse(readFileSync(written.jsonPath, 'utf-8')).status).toBe('passed');
        expect(readFileSync(written.mdPath, 'utf-8')).toContain('cycle_id: 2026-04-30-runtime-qa');
    });
    it('runs cleanup commands after a failed smoke command', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'project-script',
            commands: {
                start: 'npm run start:test',
                smoke: 'npm run smoke',
                cleanup: 'npm run stop:test',
            },
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return command === 'npm run smoke'
                ? { status: 1, stdout: '', stderr: 'smoke failed' }
                : { status: 0, stdout: 'ok', stderr: '' };
        };
        const report = runRuntimeQa({ root, auto: true, commandRunner });
        expect(report.status).toBe('failed');
        expect(calls).toEqual(['npm run start:test', 'npm run smoke', 'npm run stop:test']);
        expect(report.step_results.map((step) => `${step.name}:${step.status}`)).toEqual([
            'start:passed',
            'smoke:failed',
            'cleanup:passed',
        ]);
    });
    it('runs fixture provision and teardown around a flow smoke command', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: {
                smoke: [
                    'maestro test .maestro/delete-account.yaml',
                    'maestro test .maestro/settings.yaml',
                ],
            },
            fixtures: {
                disposableUser: {
                    provision_command: 'node scripts/create-disposable-user.mjs',
                    teardown_command: 'node scripts/delete-disposable-user.mjs',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
            ],
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, commandRunner, toolDetector });
        expect(report.status).toBe('passed');
        expect(calls).toEqual([
            'node scripts/create-disposable-user.mjs',
            'maestro test .maestro/delete-account.yaml',
            'node scripts/delete-disposable-user.mjs',
            'maestro test .maestro/settings.yaml',
        ]);
        expect(report.step_results.map((step) => step.name)).toEqual([
            'fixture-delete-account-provision',
            'smoke-1',
            'fixture-delete-account-teardown',
            'smoke-2',
        ]);
    });
    it('derives fixture lifecycle commands from a declarative Supabase provider', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: {
                smoke: 'maestro test .maestro/delete-account.yaml',
            },
            fixtures: {
                disposableUser: {
                    provider: 'supabase',
                    strategy: 'auth-admin-user',
                    backend: 'env',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
            ],
        }));
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, dryRun: true, commandRunner: vi.fn(), toolDetector });
        expect(report.step_results.map((step) => step.command)).toEqual([
            "omc runtime-qa fixture provision 'disposableUser'",
            "set -a; . '.omc/runtime-qa/disposableUser.env'; set +a; maestro test .maestro/delete-account.yaml",
            "omc runtime-qa fixture teardown 'disposableUser'",
        ]);
    });
    it('skips destructive flows without executable fixture provisioning as partial-pass', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: {
                smoke: [
                    'maestro test .maestro/delete-account.yaml',
                    'maestro test .maestro/settings.yaml',
                ],
            },
            fixtures: {
                disposableUser: {
                    provisioning: 'manual test account notes only',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
            ],
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, commandRunner, toolDetector });
        expect(report.status).toBe('partial-pass');
        expect(calls).toEqual(['maestro test .maestro/settings.yaml']);
        expect(report.step_results.map((step) => `${step.name}:${step.status}`)).toEqual([
            'smoke-1:skipped',
            'smoke-2:passed',
        ]);
        expect(report.step_results[0]?.reason).toContain('partial-pass is not complete evidence');
    });
    it('runs Claude-mediated MCP fixture flows only after the agent writes the fixture env', () => {
        const root = createRoot();
        writeArtifact(root, '.mcp.json', JSON.stringify({
            mcpServers: {
                supabase: { url: 'https://mcp.supabase.com/mcp' },
            },
        }));
        writeArtifact(root, '.omc/runtime-qa/disposableUser.env', [
            "DISPOSABLE_USER_EMAIL='runtime-qa@example.com'",
            "DISPOSABLE_USER_PASSWORD='secret'",
            "DISPOSABLE_USER_ID='user-id'",
            '',
        ].join('\n'));
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: {
                smoke: 'maestro test .maestro/delete-account.yaml',
            },
            fixtures: {
                disposableUser: {
                    provider: 'supabase',
                    strategy: 'auth-admin-user',
                    backend: 'mcp',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
            ],
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, commandRunner, toolDetector });
        expect(report.status).toBe('passed');
        expect(calls).toEqual([
            "set -a; . '.omc/runtime-qa/disposableUser.env'; set +a; maestro test .maestro/delete-account.yaml",
        ]);
        expect(report.step_results.map((step) => step.name)).toEqual(['smoke']);
    });
    it('still tears down a provisioned fixture when its smoke command fails', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: {
                smoke: [
                    'maestro test .maestro/delete-account.yaml',
                    'maestro test .maestro/next.yaml',
                ],
            },
            fixtures: {
                disposableUser: {
                    provision_command: 'node scripts/create-disposable-user.mjs',
                    teardown_command: 'node scripts/delete-disposable-user.mjs',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
                {
                    id: 'next',
                    path: '.maestro/next.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                },
            ],
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return command.includes('delete-account.yaml')
                ? { status: 1, stdout: '', stderr: 'failed' }
                : { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, commandRunner, toolDetector });
        expect(report.status).toBe('failed');
        expect(calls).toEqual([
            'node scripts/create-disposable-user.mjs',
            'maestro test .maestro/delete-account.yaml',
            'node scripts/delete-disposable-user.mjs',
        ]);
        expect(report.step_results.map((step) => `${step.name}:${step.status}`)).toEqual([
            'fixture-delete-account-provision:passed',
            'smoke-1:failed',
            'fixture-delete-account-teardown:passed',
        ]);
    });
    it('dry-runs configured commands without creating artifact directories', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'project-script',
            commands: { smoke: 'npm run smoke' },
        }));
        const report = runRuntimeQa({ root, dryRun: true, commandRunner: vi.fn() });
        expect(report.status).toBe('dry-run');
        expect(report.step_results).toEqual([
            expect.objectContaining({ name: 'smoke', status: 'dry-run' }),
        ]);
        expect(existsSync(report.artifact_dir)).toBe(false);
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
    it('normalizes legacy mobile flow configs into executable smoke commands', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            version: 1,
            platform: 'mobile',
            tooling: {
                framework: 'maestro',
                installCommand: 'curl -Ls https://get.maestro.mobile.dev | bash',
            },
            flows: [
                { id: 'return-session', path: '.maestro/return-session.yaml' },
                { id: 'delete-account', path: '.maestro/delete-account.yaml' },
            ],
        }));
        const toolDetector = (tool) => ({
            tool,
            detected: true,
            method: 'test',
        });
        const report = runRuntimeQa({ root, dryRun: true, toolDetector, commandRunner: vi.fn() });
        expect(report.status).toBe('dry-run');
        expect(report.adapter).toBe('mobile-maestro');
        expect(report.step_results.map((step) => step.command)).toEqual([
            'maestro test .maestro/return-session.yaml',
            'maestro test .maestro/delete-account.yaml',
        ]);
    });
    it('migrates legacy mobile flow configs while preserving policy metadata', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            version: 1,
            platform: 'mobile',
            tooling: {
                framework: 'maestro',
                installCommand: 'curl -Ls https://get.maestro.mobile.dev | bash',
                platformRequirements: {
                    ios: { buildCommand: 'pnpm --filter mobile ios' },
                },
            },
            fixtures: {
                disposableUser: {
                    provisioning: 'create fresh user per run via admin api',
                    provision_command: 'node scripts/create-disposable-user.mjs',
                    teardown_command: 'node scripts/delete-disposable-user.mjs',
                },
            },
            flows: [
                {
                    id: 'delete-account',
                    path: '.maestro/delete-account.yaml',
                    fixture: 'disposableUser',
                    destructive: true,
                    verifies: ['AC-DELETE'],
                    spec: '.omc/cycles/2026-04-29-cycle-4.md',
                    expectedDurationSec: 30,
                },
            ],
            gates: { passOnAllFlowsGreen: true },
            history: { firstRunStatus: 'partial-pass' },
        }));
        const preview = migrateRuntimeQaConfig({ root });
        const written = migrateRuntimeQaConfig({ root, write: true });
        const migrated = JSON.parse(readFileSync(join(root, '.omc/runtime-qa.json'), 'utf-8'));
        expect(preview.changed).toBe(true);
        expect(preview.written).toBe(false);
        expect(written.written).toBe(true);
        expect(migrated.target).toBe('mobile');
        expect(migrated.adapter).toBe('mobile-maestro');
        expect(migrated.commands.build).toEqual(['pnpm --filter mobile ios']);
        expect(migrated.commands.smoke).toEqual(['maestro test .maestro/delete-account.yaml']);
        expect(migrated.fixtures.disposableUser).toBeDefined();
        expect(migrated.fixtures.disposableUser).toMatchObject({
            provision_command: 'node scripts/create-disposable-user.mjs',
            teardown_command: 'node scripts/delete-disposable-user.mjs',
        });
        expect(migrated.flows[0]).toMatchObject({
            id: 'delete-account',
            fixture: 'disposableUser',
            destructive: true,
            spec: '.omc/cycles/2026-04-29-cycle-4.md',
        });
        expect(migrated.gates.passOnAllFlowsGreen).toBe(true);
        expect(migrated.history.firstRunStatus).toBe('partial-pass');
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
    it('reports missing Java as a Maestro prerequisite instead of a generic missing tool', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: { smoke: 'maestro test .maestro/smoke.yaml' },
        }));
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'path-prerequisite',
            command: 'maestro --version',
            missing_prerequisite: 'java-17',
            reason: 'maestro is installed, but Java 17+ is missing.',
        });
        const report = runRuntimeQa({ root, auto: true, commandRunner: vi.fn(), toolDetector });
        expect(report.status).toBe('blocked');
        expect(report.tool_detection?.missing_prerequisite).toBe('java-17');
        expect(report.install_proposal).toContain('Java 17');
    });
    it('provisions Java before Maestro smoke on macOS when install is approved', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: { smoke: 'maestro test .maestro/smoke.yaml' },
        }));
        const calls = [];
        const commandRunner = (command) => {
            calls.push(command);
            return { status: 0, stdout: 'ok', stderr: '' };
        };
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'path-prerequisite',
            command: 'maestro --version',
            missing_prerequisite: 'java-17',
            reason: 'maestro is installed, but Java 17+ is missing.',
        });
        const report = runRuntimeQa({
            root,
            auto: true,
            installMobileTools: true,
            commandRunner,
            toolDetector,
        });
        if (process.platform === 'darwin') {
            expect(report.status).toBe('passed');
            expect(calls[0]).toBe('brew install openjdk@17');
            expect(calls.at(-1)).toContain('maestro test .maestro/smoke.yaml');
        }
        else {
            expect(report.status).toBe('blocked');
            expect(calls).toEqual([]);
        }
    });
    it('renders mobile smoke commands during dry-run even when the tool is missing', () => {
        const root = createRoot();
        writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
            target: 'mobile',
            adapter: 'mobile-maestro',
            commands: { smoke: 'maestro test .maestro/smoke.yaml' },
        }));
        const toolDetector = (tool) => ({
            tool,
            detected: false,
            method: 'test',
        });
        const report = runRuntimeQa({ root, dryRun: true, commandRunner: vi.fn(), toolDetector });
        expect(report.status).toBe('dry-run');
        expect(report.install_proposal).toContain('--install-mobile-tools');
        expect(report.step_results).toEqual([
            expect.objectContaining({
                command: 'maestro test .maestro/smoke.yaml',
                status: 'dry-run',
            }),
        ]);
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
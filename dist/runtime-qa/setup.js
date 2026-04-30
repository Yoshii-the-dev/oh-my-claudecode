import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { diagnoseRuntimeQa, } from './diagnostics.js';
import { readRuntimeQaConfigRaw, } from './runner.js';
const RUNTIME_QA_SETUP_TIMEOUT_MS = 10 * 60_000;
export function setupRuntimeQaPrerequisites(root = process.cwd(), options = {}) {
    const resolvedRoot = resolve(root);
    const doctor = diagnoseRuntimeQa(resolvedRoot, options);
    const steps = buildRuntimeQaSetupPlan(resolvedRoot, doctor, options);
    const commandRunner = options.commandRunner ?? defaultSetupCommandRunner;
    if (options.apply === true) {
        for (const step of steps) {
            if (step.kind !== 'command' || !step.command) {
                step.status = 'skipped';
                continue;
            }
            const result = commandRunner(step.command, resolvedRoot, RUNTIME_QA_SETUP_TIMEOUT_MS);
            step.status = result.status === 0 && !result.error ? 'passed' : 'failed';
            step.exit_code = result.status;
            step.stdout_preview = preview(result.stdout);
            step.stderr_preview = preview(result.stderr ?? result.error?.message);
        }
    }
    const failed = steps.filter((step) => step.status === 'failed').length;
    const manual = steps.filter((step) => step.kind === 'manual').length;
    const commands = steps.filter((step) => step.kind === 'command').length;
    return {
        root: resolvedRoot,
        applied: options.apply === true,
        ok: failed === 0 && (options.apply === true ? true : steps.length === 0),
        doctor,
        steps,
        summary: { commands, manual, failed },
    };
}
export function buildRuntimeQaSetupPlan(root, doctor, options = {}) {
    const platform = options.platform ?? process.platform;
    const steps = [];
    const rawConfig = readRuntimeQaConfigRaw(root);
    if (doctor.dryRunReport.adapter === 'mobile-maestro') {
        const missingJava = hasIssue(doctor, 'runtime-qa-missing-java-17')
            || doctor.platformChecks.some((check) => check.id === 'java-17' && !check.detected);
        if (missingJava) {
            steps.push(java17SetupStep(platform));
        }
        const missingMaestro = hasIssue(doctor, 'runtime-qa-tool-missing')
            && doctor.dryRunReport.tool_detection?.tool === 'maestro';
        if (missingMaestro) {
            steps.push(...maestroSetupSteps(platform));
        }
    }
    if (rawConfig?.target === 'web' || rawConfig?.adapter === 'web-playwright' || doctor.dryRunReport.adapter === 'web-playwright') {
        steps.push(playwrightBrowsersStep(root));
    }
    if (hasIssue(doctor, 'runtime-qa-missing-xcode')) {
        steps.push({
            id: 'xcode-install',
            title: 'Install/select Xcode',
            kind: 'manual',
            reason: 'iOS simulator runtime QA requires Xcode; install Xcode and run xcode-select before rerunning doctor.',
            status: 'pending',
        });
    }
    if (hasIssue(doctor, 'runtime-qa-missing-ios-simulator')) {
        steps.push({
            id: 'ios-simulator-install',
            title: 'Install an iOS simulator runtime',
            kind: 'manual',
            reason: 'Install an iOS Simulator runtime in Xcode Settings > Platforms, then verify with xcrun simctl list devices available.',
            status: 'pending',
        });
    }
    if (hasIssue(doctor, 'runtime-qa-missing-android-sdk') || hasIssue(doctor, 'runtime-qa-missing-android-emulator')) {
        steps.push(androidSdkSetupStep(platform));
    }
    return dedupeSteps(steps);
}
function java17SetupStep(platform) {
    if (platform === 'darwin') {
        return {
            id: 'java-17-install',
            title: 'Install Java 17 for Maestro',
            kind: 'command',
            command: 'brew install openjdk@17',
            reason: 'Maestro requires Java 17+ and doctor did not detect it.',
            status: 'pending',
        };
    }
    return {
        id: 'java-17-install',
        title: 'Install Java 17 for Maestro',
        kind: 'manual',
        reason: 'Install OpenJDK 17+ with the OS package manager and rerun omc doctor runtime-qa.',
        status: 'pending',
    };
}
function maestroSetupSteps(platform) {
    if (platform === 'darwin') {
        return [
            {
                id: 'maestro-tap',
                title: 'Add Maestro Homebrew tap',
                kind: 'command',
                command: 'brew tap mobile-dev-inc/tap',
                reason: 'Maestro is required for mobile-maestro runtime QA.',
                status: 'pending',
            },
            {
                id: 'maestro-install',
                title: 'Install Maestro',
                kind: 'command',
                command: 'brew install mobile-dev-inc/tap/maestro',
                reason: 'Maestro is required for mobile-maestro runtime QA.',
                status: 'pending',
            },
        ];
    }
    return [{
            id: 'maestro-install',
            title: 'Install Maestro',
            kind: 'command',
            command: 'curl -fsSL "https://get.maestro.mobile.dev" | bash',
            reason: 'Maestro is required for mobile-maestro runtime QA.',
            status: 'pending',
        }];
}
function playwrightBrowsersStep(root) {
    const manager = existsSync(resolve(root, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : existsSync(resolve(root, 'yarn.lock'))
            ? 'yarn'
            : 'npm';
    const command = manager === 'pnpm'
        ? 'pnpm exec playwright install'
        : manager === 'yarn'
            ? 'yarn playwright install'
            : 'npx playwright install';
    return {
        id: 'playwright-browsers-install',
        title: 'Install Playwright browsers',
        kind: 'command',
        command,
        reason: 'web-playwright runtime QA needs browser binaries installed.',
        status: 'pending',
    };
}
function androidSdkSetupStep(platform) {
    if (platform === 'darwin') {
        return {
            id: 'android-sdk-install',
            title: 'Install Android SDK/emulator',
            kind: 'manual',
            reason: 'Install Android Studio or command line tools, then set ANDROID_HOME/ANDROID_SDK_ROOT and install platform-tools plus emulator.',
            status: 'pending',
        };
    }
    return {
        id: 'android-sdk-install',
        title: 'Install Android SDK/emulator',
        kind: 'manual',
        reason: 'Install Android command line tools, set ANDROID_HOME/ANDROID_SDK_ROOT, and install platform-tools plus emulator.',
        status: 'pending',
    };
}
function hasIssue(report, code) {
    return report.issues.some((issue) => issue.code === code);
}
function dedupeSteps(steps) {
    const seen = new Set();
    return steps.filter((step) => {
        if (seen.has(step.id))
            return false;
        seen.add(step.id);
        return true;
    });
}
function defaultSetupCommandRunner(command, cwd, timeoutMs) {
    const result = spawnSync(command, {
        cwd,
        shell: true,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
    });
    return {
        status: result.status,
        signal: result.signal,
        error: result.error,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
function preview(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length <= 500)
        return trimmed;
    return `${trimmed.slice(0, 500)}...`;
}
//# sourceMappingURL=setup.js.map
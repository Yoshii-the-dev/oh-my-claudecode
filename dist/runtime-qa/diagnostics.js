import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { RUNTIME_QA_CONFIG_RELATIVE_PATH, RUNTIME_QA_HANDOFF_RELATIVE_PATH, readRuntimeQaConfigRaw, runRuntimeQa, shouldRunRuntimeQa, } from './runner.js';
import { resolveFixtureProvider } from './fixture-providers.js';
const RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS = 5_000;
export function diagnoseRuntimeQa(root = process.cwd(), options = {}) {
    const resolvedRoot = resolve(root);
    const configPath = resolve(resolvedRoot, RUNTIME_QA_CONFIG_RELATIVE_PATH);
    const handoffPath = resolve(resolvedRoot, RUNTIME_QA_HANDOFF_RELATIVE_PATH);
    const configExists = existsSync(configPath);
    const handoffExists = existsSync(handoffPath);
    const activeCycleId = readActiveCycleId(resolvedRoot);
    const dryRunReport = runRuntimeQa({ root: resolvedRoot, dryRun: true, toolDetector: options.toolDetector });
    const handoff = readJson(handoffPath);
    const rawConfig = readRuntimeQaConfigRaw(resolvedRoot);
    const platformChecks = inspectPlatformReadiness(resolvedRoot, rawConfig, dryRunReport, options);
    const destructiveFlows = inspectDestructiveFlows(resolvedRoot, rawConfig);
    const issues = [];
    if (!configExists && shouldRunRuntimeQa(resolvedRoot)) {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-config-missing',
            message: 'Cycle asks for runtime QA/simulator evidence, but .omc/runtime-qa.json is missing.',
            path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        });
    }
    if (dryRunReport.status === 'blocked') {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-blocked',
            message: dryRunReport.step_results[0]?.reason ?? 'Runtime QA is blocked.',
            path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        });
    }
    if (dryRunReport.status === 'noop') {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-no-executable-commands',
            message: 'Runtime QA config produced no executable build/smoke commands.',
            path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        });
    }
    if (dryRunReport.tool_detection && !dryRunReport.tool_detection.detected) {
        pushIssue(issues, {
            severity: 'error',
            code: dryRunReport.tool_detection.missing_prerequisite
                ? `runtime-qa-missing-${dryRunReport.tool_detection.missing_prerequisite}`
                : 'runtime-qa-tool-missing',
            message: dryRunReport.tool_detection.reason
                ?? `${dryRunReport.tool_detection.tool} is required but was not detected.`,
            path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        });
    }
    for (const check of platformChecks) {
        if (check.required && !check.detected) {
            pushIssue(issues, {
                severity: 'error',
                code: `runtime-qa-missing-${check.id}`,
                message: check.reason,
                path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
            });
        }
    }
    for (const flow of destructiveFlows) {
        if (!flow.provisioned) {
            const requiresAgentMcp = flow.requiresAgentMcp === true;
            issues.push({
                severity: 'error',
                code: requiresAgentMcp
                    ? 'runtime-qa-fixture-agent-mcp-required'
                    : 'runtime-qa-destructive-fixture-missing',
                message: destructiveFixtureMessage(flow, requiresAgentMcp),
                path: flow.path,
            });
        }
    }
    if (!handoffExists) {
        issues.push({
            severity: 'warning',
            code: 'runtime-qa-handoff-missing',
            message: 'No executed runtime QA handoff report exists yet.',
            path: RUNTIME_QA_HANDOFF_RELATIVE_PATH,
        });
    }
    else {
        inspectHandoff(handoff, activeCycleId, rawConfig, issues);
    }
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    return {
        ok: errors === 0,
        root: resolvedRoot,
        configPath,
        configExists,
        handoffPath,
        handoffExists,
        shouldRun: shouldRunRuntimeQa(resolvedRoot),
        activeCycleId,
        dryRunReport,
        handoff,
        platformChecks,
        destructiveFlows,
        issues,
        summary: { errors, warnings },
    };
}
function destructiveFixtureMessage(flow, requiresAgentMcp) {
    if (requiresAgentMcp) {
        return `Destructive runtime QA flow ${flow.id} uses Supabase MCP; run it through the Claude/OMC agent provisioning step so ${flow.fixture ?? 'the fixture'} writes its runtime env before simulator execution.`;
    }
    if (flow.reason) {
        return `Destructive runtime QA flow ${flow.id} fixture is not runnable: ${flow.reason}`;
    }
    return `Destructive runtime QA flow ${flow.id} must declare a disposable fixture with an executable provision_command or provider.`;
}
function pushIssue(issues, issue) {
    if (issues.some((existing) => existing.code === issue.code && existing.path === issue.path))
        return;
    issues.push(issue);
}
function inspectPlatformReadiness(root, config, dryRunReport, options) {
    if (!isMobileRuntimeQa(config, dryRunReport))
        return [];
    const commandRunner = options.commandRunner ?? defaultDoctorCommandRunner;
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const scope = mobileReadinessScope(config, dryRunReport, platform);
    const checks = [];
    if (dryRunReport.adapter === 'mobile-maestro') {
        checks.push(checkJava17(root, commandRunner));
    }
    if (scope.ios) {
        checks.push(checkXcode(root, commandRunner, platform));
        checks.push(checkIosSimulator(root, commandRunner, platform));
    }
    if (scope.android) {
        checks.push(checkAndroidSdk(root, commandRunner, env));
        checks.push(checkAndroidEmulator(root, commandRunner, env));
    }
    return checks;
}
function isMobileRuntimeQa(config, dryRunReport) {
    if (dryRunReport.adapter.startsWith('mobile-'))
        return true;
    return config?.target === 'mobile' || config?.platform === 'mobile';
}
function mobileReadinessScope(config, dryRunReport, platform) {
    const text = [
        config?.target,
        config?.adapter,
        config?.platform,
        config?.mobile?.tool,
        config?.mobile?.command,
        config?.tooling?.framework,
        config?.tooling?.installCommand,
        ...commandValues(config?.commands),
        ...Object.values(config?.tooling?.platformRequirements ?? {}).flatMap((entry) => commandValues(entry?.buildCommand)),
        ...(config?.flows ?? []).flatMap((flow) => [flow.path, flow.id]),
        ...(dryRunReport.step_results ?? []).flatMap((step) => [step.command, step.name]),
    ].filter((value) => typeof value === 'string').join('\n').toLowerCase();
    const ios = /\b(ios|iphone|ipad|xcode|simctl|simulator)\b/.test(text);
    const android = /\b(android|adb|avd|emulator)\b/.test(text);
    if (ios || android)
        return { ios, android };
    return platform === 'darwin' ? { ios: true, android: false } : { ios: false, android: true };
}
function commandValues(value) {
    if (typeof value === 'string')
        return [value];
    if (Array.isArray(value))
        return value.filter((entry) => typeof entry === 'string');
    return [];
}
function checkJava17(root, commandRunner) {
    const command = 'java -version';
    const result = commandRunner(command, root, RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const version = output.match(/version\s+"(\d+)(?:[._]\d+)?/i)?.[1];
    const detected = result.status === 0 && Number(version ?? '0') >= 17;
    return {
        id: 'java-17',
        label: 'Java 17+',
        required: true,
        detected,
        command,
        reason: detected
            ? `Java ${version}+ is visible to runtime QA.`
            : 'Java 17+ is required for Maestro runtime QA but was not detected.',
    };
}
function checkXcode(root, commandRunner, platform) {
    const command = 'xcode-select -p';
    if (platform !== 'darwin') {
        return {
            id: 'xcode',
            label: 'Xcode command line tools',
            required: true,
            detected: false,
            command,
            reason: 'iOS simulator runtime QA requires macOS with Xcode command line tools.',
        };
    }
    const result = commandRunner(command, root, RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS);
    const detected = result.status === 0 && String(result.stdout ?? '').trim().length > 0;
    return {
        id: 'xcode',
        label: 'Xcode command line tools',
        required: true,
        detected,
        command,
        reason: detected
            ? 'Xcode command line tools are selected.'
            : 'Xcode command line tools are required for iOS simulator runtime QA.',
    };
}
function checkIosSimulator(root, commandRunner, platform) {
    const command = 'xcrun simctl list devices available';
    if (platform !== 'darwin') {
        return {
            id: 'ios-simulator',
            label: 'iOS Simulator',
            required: true,
            detected: false,
            command,
            reason: 'iOS simulator runtime QA requires macOS with simctl.',
        };
    }
    const result = commandRunner(command, root, RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const detected = result.status === 0 && /\(.+\)/.test(output);
    return {
        id: 'ios-simulator',
        label: 'iOS Simulator',
        required: true,
        detected,
        command,
        reason: detected
            ? 'At least one available iOS simulator device was detected.'
            : 'No available iOS simulator device was detected via simctl.',
    };
}
function checkAndroidSdk(root, commandRunner, env) {
    const sdkRoot = resolveAndroidSdkRoot(env);
    const command = 'command -v adb';
    const adb = commandRunner(command, root, RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS);
    const detected = Boolean(sdkRoot && existsSync(sdkRoot)) || adb.status === 0;
    return {
        id: 'android-sdk',
        label: 'Android SDK',
        required: true,
        detected,
        command,
        reason: detected
            ? 'Android SDK or adb was detected.'
            : 'Android runtime QA requires ANDROID_HOME/ANDROID_SDK_ROOT or adb on PATH.',
    };
}
function checkAndroidEmulator(root, commandRunner, env) {
    const sdkRoot = resolveAndroidSdkRoot(env);
    const emulatorPath = sdkRoot ? resolve(sdkRoot, 'emulator', 'emulator') : undefined;
    const command = 'command -v emulator';
    const result = commandRunner(command, root, RUNTIME_QA_DOCTOR_COMMAND_TIMEOUT_MS);
    const detected = (emulatorPath ? existsSync(emulatorPath) : false) || result.status === 0;
    return {
        id: 'android-emulator',
        label: 'Android emulator',
        required: true,
        detected,
        command,
        reason: detected
            ? 'Android emulator binary was detected.'
            : 'Android runtime QA requires an emulator binary from the Android SDK.',
    };
}
function resolveAndroidSdkRoot(env) {
    const configured = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
    if (configured)
        return configured;
    const defaultMac = resolve(homedir(), 'Library', 'Android', 'sdk');
    if (existsSync(defaultMac))
        return defaultMac;
    const defaultLinux = resolve(homedir(), 'Android', 'Sdk');
    if (existsSync(defaultLinux))
        return defaultLinux;
    return undefined;
}
function defaultDoctorCommandRunner(command, cwd, timeoutMs) {
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
function inspectHandoff(handoff, activeCycleId, rawConfig, issues) {
    const status = typeof handoff?.status === 'string' ? handoff.status : 'unknown';
    const dryRun = typeof handoff?.dry_run === 'boolean' ? handoff.dry_run : false;
    if (status !== 'passed') {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-handoff-not-passed',
            message: `Latest runtime QA handoff status is ${status}, expected passed.`,
            path: RUNTIME_QA_HANDOFF_RELATIVE_PATH,
        });
    }
    if (dryRun) {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-handoff-dry-run',
            message: 'Latest runtime QA handoff is a dry-run and does not prove simulator execution.',
            path: RUNTIME_QA_HANDOFF_RELATIVE_PATH,
        });
    }
    if (!activeCycleId)
        return;
    const handoffCycle = readStringField(handoff, 'cycle_id');
    if (!handoffCycle) {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-handoff-cycle-missing',
            message: `Latest runtime QA handoff does not declare cycle_id for active cycle ${activeCycleId}.`,
            path: RUNTIME_QA_HANDOFF_RELATIVE_PATH,
        });
        return;
    }
    if (handoffCycle && handoffCycle !== activeCycleId) {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-handoff-stale-cycle',
            message: `Latest runtime QA handoff is for cycle ${handoffCycle}, but active cycle is ${activeCycleId}.`,
            path: RUNTIME_QA_HANDOFF_RELATIVE_PATH,
        });
    }
    const specs = (rawConfig?.flows ?? [])
        .map((flow) => (typeof flow.spec === 'string' ? flow.spec : ''))
        .filter(Boolean);
    if (specs.length > 0 && specs.every((spec) => !spec.includes(activeCycleId))) {
        issues.push({
            severity: 'error',
            code: 'runtime-qa-flow-spec-stale-cycle',
            message: `Runtime QA flow specs do not reference active cycle ${activeCycleId}.`,
            path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
        });
    }
}
function readStringField(value, field) {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value;
    return typeof record[field] === 'string' ? record[field] : undefined;
}
function inspectDestructiveFlows(root, config) {
    const fixtures = config?.fixtures ?? {};
    return (config?.flows ?? [])
        .filter((flow) => flow.destructive === true)
        .map((flow, index) => {
        const id = typeof flow.id === 'string' ? flow.id : `flow-${index + 1}`;
        const path = typeof flow.path === 'string' ? flow.path : RUNTIME_QA_CONFIG_RELATIVE_PATH;
        const fixture = typeof flow.fixture === 'string' ? flow.fixture : undefined;
        const fixtureConfig = fixture ? fixtures[fixture] : undefined;
        const provider = fixture ? resolveFixtureProvider(root, fixture, normalizeDiagnosticFixture(fixtureConfig)) : undefined;
        return {
            id,
            path,
            fixture,
            provider: provider?.provider,
            backend: provider?.backend,
            provisioned: hasExecutableProvisioning(fixtureConfig) || Boolean(provider?.supported && provider.available),
            requiresAgentMcp: provider?.requiresAgentMcp,
            reason: provider?.supported && !provider.available ? provider.reason : undefined,
        };
    });
}
function hasExecutableProvisioning(fixture) {
    return typeof fixture?.provision_command === 'string' && fixture.provision_command.trim().length > 0;
}
function normalizeDiagnosticFixture(fixture) {
    if (!fixture)
        return undefined;
    return {
        ...(typeof fixture.provisioning === 'string' ? { provisioning: fixture.provisioning } : {}),
        ...(typeof fixture.provision_command === 'string' ? { provision_command: fixture.provision_command } : {}),
        ...(typeof fixture.teardown_command === 'string' ? { teardown_command: fixture.teardown_command } : {}),
        ...(fixture.provider === 'supabase' ? { provider: 'supabase' } : {}),
        ...(fixture.strategy === 'auth-admin-user' ? { strategy: 'auth-admin-user' } : {}),
        ...(isFixtureBackend(fixture.backend) ? { backend: fixture.backend } : {}),
    };
}
function isFixtureBackend(value) {
    return value === 'auto' || value === 'env' || value === 'mcp';
}
function readActiveCycleId(root) {
    const content = safeRead(resolve(root, '.omc/cycles/current.md'));
    if (!content)
        return undefined;
    const match = content.match(/^\s*cycle_id\s*:\s*(.*?)\s*$/im);
    return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}
function readJson(path) {
    if (!existsSync(path))
        return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
function safeRead(path) {
    if (!existsSync(path))
        return undefined;
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=diagnostics.js.map
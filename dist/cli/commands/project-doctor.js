/**
 * Aggregated project doctor/setup preflight for common OMC project footguns.
 */
import { resolve } from 'path';
import { shouldRunRuntimeQa } from '../../runtime-qa/runner.js';
import { setupRuntimeQaPrerequisites, } from '../../runtime-qa/setup.js';
import { runStateHygiene, } from './state-hygiene.js';
import { colors, renderTable } from '../utils/formatting.js';
export async function projectDoctorCommand(root, options, logger = console) {
    const report = inspectProjectDoctor(root, options);
    logger.log(options.json ? JSON.stringify(report, null, 2) : renderProjectDoctorReport(report));
    return report.ok ? 0 : 1;
}
export function inspectProjectDoctor(root, options = {}) {
    const resolvedRoot = resolve(root ?? process.cwd());
    const stateHygiene = runStateHygiene(resolvedRoot, { apply: options.applyStateHygiene === true });
    const runtimeQaApplies = shouldRunRuntimeQa(resolvedRoot);
    const runtimeQaSetup = runtimeQaApplies
        ? setupRuntimeQaPrerequisites(resolvedRoot, { apply: options.applyRuntimeQaSetup === true })
        : undefined;
    const checks = [
        stateHygieneCheck(stateHygiene),
        runtimeQaCheck(runtimeQaSetup),
    ];
    const passed = checks.filter((check) => check.status === 'pass').length;
    const warnings = checks.filter((check) => check.status === 'warning').length;
    const failed = checks.filter((check) => check.status === 'fail').length;
    const skipped = checks.filter((check) => check.status === 'skipped').length;
    return {
        ok: failed === 0,
        root: resolvedRoot,
        applied: {
            stateHygiene: stateHygiene.applied,
            runtimeQaSetup: runtimeQaSetup?.applied ?? false,
        },
        checks,
        stateHygiene,
        runtimeQaSetup,
        summary: { passed, warnings, failed, skipped },
    };
}
export function renderProjectDoctorReport(report) {
    const lines = [
        colors.bold('OMC project doctor'),
        `root: ${report.root}`,
    ];
    lines.push('');
    lines.push(renderTable(report.checks.map((check) => ({
        check: check.label,
        status: colorStatus(check.status),
        summary: check.summary,
        next: check.recommendation ?? '-',
    })), [
        { header: 'check', field: 'check', width: 26 },
        { header: 'status', field: 'status', width: 10 },
        { header: 'summary', field: 'summary', width: 72 },
        { header: 'next', field: 'next', width: 72 },
    ]));
    if (report.runtimeQaSetup?.steps.length) {
        lines.push('');
        lines.push(colors.bold('Runtime QA setup plan'));
        for (const step of report.runtimeQaSetup.steps) {
            lines.push(`  - ${step.title}: ${step.status}${step.command ? ` (${step.command})` : ''}`);
        }
    }
    lines.push('');
    lines.push(report.ok
        ? colors.green(`Pass: ${report.summary.passed} passed, ${report.summary.warnings} warning(s), ${report.summary.skipped} skipped.`)
        : colors.red(`Fail: ${report.summary.failed} failed, ${report.summary.warnings} warning(s), ${report.summary.skipped} skipped.`));
    return lines.join('\n');
}
function stateHygieneCheck(report) {
    if (report.ok) {
        return {
            id: 'state-hygiene',
            label: 'State hygiene',
            ok: true,
            status: 'pass',
            summary: report.applied
                ? 'Runtime state was removed from the git index.'
                : 'No tracked runtime state was found.',
        };
    }
    const notGit = report.issues.some((issue) => issue.code === 'not-a-git-repository');
    if (notGit) {
        return {
            id: 'state-hygiene',
            label: 'State hygiene',
            ok: true,
            status: 'warning',
            summary: 'Project root is not inside a git repository.',
            recommendation: 'Run from a project git root to enable runtime state hygiene.',
        };
    }
    return {
        id: 'state-hygiene',
        label: 'State hygiene',
        ok: false,
        status: 'fail',
        summary: `${report.trackedRuntimeFileCount} runtime state file(s) are tracked by git.`,
        recommendation: 'Run `omc state-hygiene --apply` or `omc setup --apply-project-fixes`.',
    };
}
function runtimeQaCheck(report) {
    if (!report) {
        return {
            id: 'runtime-qa',
            label: 'Runtime QA',
            ok: true,
            status: 'skipped',
            summary: 'No runtime QA config or cycle signal was detected.',
        };
    }
    const commandSteps = report.steps.filter((step) => step.kind === 'command');
    const manualSteps = report.steps.filter((step) => step.kind === 'manual');
    const runtimeErrors = report.doctor.summary.errors;
    const failedSetupSteps = report.summary.failed;
    if (runtimeErrors === 0 && failedSetupSteps === 0 && report.steps.length === 0) {
        return {
            id: 'runtime-qa',
            label: 'Runtime QA',
            ok: true,
            status: 'pass',
            summary: `Runtime QA is ready with ${report.doctor.summary.warnings} warning(s).`,
        };
    }
    return {
        id: 'runtime-qa',
        label: 'Runtime QA',
        ok: false,
        status: 'fail',
        summary: `${runtimeErrors} doctor error(s), ${commandSteps.length} command setup step(s), ${manualSteps.length} manual setup step(s).`,
        recommendation: runtimeQaRecommendation(report, commandSteps.length, manualSteps.length),
    };
}
function runtimeQaRecommendation(report, commandSteps, manualSteps) {
    if (!report.applied && commandSteps > 0) {
        return 'Run `omc runtime-qa setup --apply` for command steps, then `omc doctor runtime-qa`.';
    }
    if (manualSteps > 0) {
        return 'Complete manual platform setup steps, then run `omc doctor runtime-qa`.';
    }
    return 'Run `omc doctor runtime-qa` for fixture, handoff freshness, and runtime evidence details.';
}
function colorStatus(status) {
    if (status === 'pass')
        return colors.green(status);
    if (status === 'fail')
        return colors.red(status);
    if (status === 'warning')
        return colors.yellow(status);
    return status;
}
//# sourceMappingURL=project-doctor.js.map
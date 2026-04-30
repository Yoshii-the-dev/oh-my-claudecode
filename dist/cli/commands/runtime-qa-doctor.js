/**
 * `omc doctor runtime-qa` — read-only runtime QA readiness and evidence checks.
 */
import { diagnoseRuntimeQa } from '../../runtime-qa/diagnostics.js';
import { colors, renderTable } from '../utils/formatting.js';
export async function runtimeQaDoctorCommand(root, options, logger = console) {
    const report = diagnoseRuntimeQa(root);
    logger.log(options.json ? JSON.stringify(report, null, 2) : renderRuntimeQaDoctorReport(report));
    return report.ok ? 0 : 1;
}
function renderRuntimeQaDoctorReport(report) {
    const lines = [
        colors.bold('Runtime QA diagnostics'),
        `root: ${report.root}`,
        `config: ${report.configExists ? report.configPath : 'missing'}`,
        `handoff: ${report.handoffExists ? report.handoffPath : 'missing'}`,
        `adapter: ${report.dryRunReport.adapter}`,
        `dryRunStatus: ${report.dryRunReport.status}`,
    ];
    if (report.dryRunReport.tool_detection) {
        const detection = report.dryRunReport.tool_detection;
        lines.push(`tool: ${detection.tool} ${detection.detected ? 'detected' : 'missing'} (${detection.method})`);
        if (detection.missing_prerequisite) {
            lines.push(`missingPrerequisite: ${detection.missing_prerequisite}`);
        }
    }
    if (report.platformChecks.length > 0) {
        lines.push('');
        lines.push(renderTable(report.platformChecks.map((check) => ({
            check: check.label,
            required: check.required ? 'yes' : 'no',
            status: check.detected ? colors.green('detected') : colors.red('missing'),
            reason: check.reason,
        })), [
            { header: 'check', field: 'check', width: 28 },
            { header: 'required', field: 'required', width: 10 },
            { header: 'status', field: 'status', width: 12 },
            { header: 'reason', field: 'reason', width: 80 },
        ]));
    }
    if (report.dryRunReport.step_results.length > 0) {
        lines.push('');
        lines.push(renderTable(report.dryRunReport.step_results.map((step) => ({
            step: step.name,
            status: step.status,
            command: step.command ?? '-',
        })), [
            { header: 'step', field: 'step', width: 18 },
            { header: 'status', field: 'status', width: 10 },
            { header: 'command', field: 'command', width: 80 },
        ]));
    }
    if (report.issues.length > 0) {
        lines.push('');
        lines.push(renderTable(report.issues.map((issue) => ({
            severity: issue.severity === 'error' ? colors.red(issue.severity) : colors.yellow(issue.severity),
            code: issue.code,
            message: issue.message,
        })), [
            { header: 'severity', field: 'severity', width: 10 },
            { header: 'code', field: 'code', width: 38 },
            { header: 'message', field: 'message', width: 90 },
        ]));
    }
    lines.push('');
    lines.push(report.ok
        ? colors.green(`Pass: ${report.summary.warnings} warning(s).`)
        : colors.red(`Fail: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`));
    return lines.join('\n');
}
//# sourceMappingURL=runtime-qa-doctor.js.map
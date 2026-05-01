/**
 * `omc creative-loop` — UI/UX creative loop artifact checks.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { initCreativeLoop, generateVisualLifecycleReport, planCreativeLoop, renderCreativeLoopPlan, renderVisualLifecycleReport, writeCreativeLoopPlan, writeVisualLifecycleReport, } from '../../product/creative-loop.js';
export async function creativeLoopAuditCommand(root, options, logger = console) {
    const plan = planCreativeLoop({ root, goal: options.goal });
    const written = options.write ? writeCreativeLoopPlan(root, plan) : undefined;
    const visualLifecycle = generateVisualLifecycleReport({ root, goal: options.goal });
    const visualLifecycleWritten = options.write ? writeVisualLifecycleReport(root, visualLifecycle) : undefined;
    if (options.json) {
        logger.log(JSON.stringify({ ...plan, written, visual_lifecycle: visualLifecycle, visual_lifecycle_written: visualLifecycleWritten }, null, 2));
    }
    else {
        logger.log(renderAudit(plan, written, visualLifecycle, visualLifecycleWritten));
    }
    return plan.status === 'ready' ? 0 : 1;
}
export async function creativeLoopLifecycleCommand(root, options, logger = console) {
    const report = generateVisualLifecycleReport({ root, goal: options.goal });
    const written = options.write ? writeVisualLifecycleReport(root, report) : undefined;
    if (options.json) {
        logger.log(JSON.stringify({ ...report, written }, null, 2));
    }
    else if (options.write) {
        logger.log(renderLifecycleSummary(report, written));
    }
    else {
        logger.log(renderVisualLifecycleReport(report));
        logger.log(colors.gray('Use --write to persist .omc/design/visual-lifecycle/current.{json,md}.'));
    }
    return report.status === 'healthy' ? 0 : 1;
}
export async function creativeLoopInitCommand(root, options, logger = console) {
    const plan = initCreativeLoop({ root, goal: options.goal });
    const visualLifecycle = generateVisualLifecycleReport({ root, goal: options.goal });
    if (options.json) {
        logger.log(JSON.stringify({ ...plan, visual_lifecycle: visualLifecycle }, null, 2));
    }
    else {
        logger.log(renderAudit(plan, undefined, visualLifecycle, undefined));
    }
    return 0;
}
function renderAudit(plan, written, visualLifecycle, visualLifecycleWritten) {
    const lines = [
        colors.bold('Creative loop readiness'),
        `status: ${statusColor(plan.status)}`,
        `visual_lifecycle: ${formatLifecycleStatus(visualLifecycle.status)}`,
        `goal: ${plan.goal ?? 'unknown'}`,
    ];
    if (written) {
        lines.push(`artifacts: ${written.jsonPath}, ${written.mdPath}`);
    }
    if (visualLifecycleWritten) {
        lines.push(`visual_lifecycle_artifacts: ${visualLifecycleWritten.jsonPath}, ${visualLifecycleWritten.mdPath}`);
    }
    lines.push('');
    lines.push(renderTable(plan.artifacts.map((artifact) => ({
        artifact: artifact.id,
        required: artifact.required ? 'yes' : 'no',
        passed: artifact.passed ? colors.green('yes') : colors.yellow('no'),
        path: artifact.path,
        reason: artifact.reason,
    })), [
        { header: 'artifact', field: 'artifact', width: 22 },
        { header: 'required', field: 'required', width: 10 },
        { header: 'passed', field: 'passed', width: 10 },
        { header: 'path', field: 'path', width: 44 },
        { header: 'reason', field: 'reason', width: 54 },
    ]));
    lines.push('');
    lines.push(colors.bold('Next commands'));
    for (const command of plan.recommended_commands)
        lines.push(`- ${command}`);
    if (!written) {
        lines.push('');
        lines.push(colors.gray('Use --write to persist the creative-loop handoff.'));
    }
    return lines.join('\n');
}
function renderLifecycleSummary(report, written) {
    return [
        colors.bold('Visual lifecycle'),
        `status: ${formatLifecycleStatus(report.status)}`,
        `phases: ${report.aggregates.ready_phases}/${report.aggregates.phase_count}, screenshot_proofs: ${report.aggregates.screenshot_proofs}, debts: ${report.aggregates.iteration_debts}, blocking: ${report.aggregates.blocking_debts}`,
        written ? `artifacts: ${written.jsonPath}, ${written.mdPath}` : undefined,
        '',
        renderTable(report.phases.map((phase) => ({
            phase: phase.id,
            state: phase.state,
            gaps: phase.gaps.join('; ') || 'none',
            action: phase.recommended_action,
        })), [
            { header: 'phase', field: 'phase', width: 24 },
            { header: 'state', field: 'state', width: 12 },
            { header: 'gaps', field: 'gaps', width: 44 },
            { header: 'action', field: 'action', width: 76 },
        ]),
        '',
        `next_action: ${report.next_action}`,
    ].filter((line) => typeof line === 'string').join('\n');
}
function statusColor(status) {
    if (status === 'ready')
        return colors.green(status);
    return colors.yellow(status);
}
function formatLifecycleStatus(status) {
    if (status === 'healthy')
        return colors.green(status);
    if (status === 'empty')
        return colors.red(status);
    return colors.yellow(status);
}
export { renderCreativeLoopPlan };
//# sourceMappingURL=creative-loop.js.map
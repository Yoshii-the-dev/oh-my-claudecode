/**
 * `omc creative-loop` — UI/UX creative loop artifact checks.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { initCreativeLoop, planCreativeLoop, renderCreativeLoopPlan, writeCreativeLoopPlan, } from '../../product/creative-loop.js';
export async function creativeLoopAuditCommand(root, options, logger = console) {
    const plan = planCreativeLoop({ root, goal: options.goal });
    const written = options.write ? writeCreativeLoopPlan(root, plan) : undefined;
    if (options.json) {
        logger.log(JSON.stringify({ ...plan, written }, null, 2));
    }
    else {
        logger.log(renderAudit(plan, written));
    }
    return plan.status === 'ready' ? 0 : 1;
}
export async function creativeLoopInitCommand(root, options, logger = console) {
    const plan = initCreativeLoop({ root, goal: options.goal });
    if (options.json) {
        logger.log(JSON.stringify(plan, null, 2));
    }
    else {
        logger.log(renderAudit(plan, undefined));
    }
    return 0;
}
function renderAudit(plan, written) {
    const lines = [
        colors.bold('Creative loop readiness'),
        `status: ${statusColor(plan.status)}`,
        `goal: ${plan.goal ?? 'unknown'}`,
    ];
    if (written) {
        lines.push(`artifacts: ${written.jsonPath}, ${written.mdPath}`);
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
function statusColor(status) {
    if (status === 'ready')
        return colors.green(status);
    return colors.yellow(status);
}
export { renderCreativeLoopPlan };
//# sourceMappingURL=creative-loop.js.map
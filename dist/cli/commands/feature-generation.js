/**
 * `omc feature-generation` — source/MCP readiness for product idea generation.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { planFeatureGeneration, renderFeatureGenerationPlan, writeFeatureGenerationPlan, } from '../../product/feature-generation.js';
export async function featureGenerationAuditCommand(root, options, logger = console) {
    const plan = planFeatureGeneration({ root, goal: options.goal });
    const written = options.write ? writeFeatureGenerationPlan(root, plan) : undefined;
    if (options.json) {
        logger.log(JSON.stringify({ ...plan, written }, null, 2));
    }
    else {
        logger.log(renderAudit(plan, written));
    }
    return plan.status === 'blocked' ? 1 : 0;
}
function renderAudit(plan, written) {
    const lines = [
        colors.bold('Feature generation readiness'),
        `status: ${statusColor(plan.status)}`,
        `source score: ${plan.source_score}/${plan.required_source_count}`,
        `goal: ${plan.goal ?? 'unknown'}`,
    ];
    if (written) {
        lines.push(`artifacts: ${written.jsonPath}, ${written.mdPath}`);
    }
    lines.push('');
    lines.push(renderTable(plan.sources.map((source) => ({
        kind: source.kind,
        status: source.status === 'present' ? colors.green(source.status) : colors.yellow(source.status),
        path: source.path,
        reason: source.reason,
    })), [
        { header: 'source', field: 'kind', width: 16 },
        { header: 'status', field: 'status', width: 10 },
        { header: 'path', field: 'path', width: 42 },
        { header: 'reason', field: 'reason', width: 60 },
    ]));
    lines.push('');
    lines.push(colors.bold('MCP recommendations'));
    lines.push(renderTable(plan.mcp.map((entry) => ({
        server: entry.server,
        configured: entry.configured ? colors.green('yes') : colors.yellow('no'),
        required: entry.required ? 'yes' : 'no',
        setup: entry.setup,
    })), [
        { header: 'server', field: 'server', width: 16 },
        { header: 'configured', field: 'configured', width: 12 },
        { header: 'required', field: 'required', width: 10 },
        { header: 'setup', field: 'setup', width: 54 },
    ]));
    if (plan.blockers.length > 0) {
        lines.push('');
        lines.push(colors.bold('Blockers'));
        for (const blocker of plan.blockers)
            lines.push(`- ${blocker}`);
    }
    lines.push('');
    lines.push(colors.bold('Next commands'));
    for (const command of plan.recommended_commands)
        lines.push(`- ${command}`);
    if (!written) {
        lines.push('');
        lines.push(colors.gray('Use --write to persist the handoff for priority-engine.'));
    }
    return lines.join('\n');
}
function statusColor(status) {
    if (status === 'ready')
        return colors.green(status);
    if (status === 'blocked')
        return colors.red(status);
    return colors.yellow(status);
}
export { renderFeatureGenerationPlan };
//# sourceMappingURL=feature-generation.js.map
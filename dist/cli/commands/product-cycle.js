/**
 * `omc product-cycle` — runtime FSM for the product learning loop.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { advanceProductCycle, getNextProductCycleAction, isProductCycleStage, validateProductCycle, } from '../../product/cycle-fsm.js';
import { runProductCycle, } from '../../product/cycle-runner.js';
export async function productCycleStatusCommand(root, options, logger = console) {
    const snapshot = getNextProductCycleAction(root);
    logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
    return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}
export async function productCycleNextCommand(root, options, logger = console) {
    const snapshot = getNextProductCycleAction(root);
    if (options.json) {
        logger.log(JSON.stringify({ nextAction: snapshot.nextAction, nextStage: snapshot.nextStage, snapshot }, null, 2));
    }
    else {
        logger.log(snapshot.nextAction);
    }
    return 0;
}
export async function productCycleValidateCommand(root, options, logger = console) {
    const snapshot = validateProductCycle(root);
    logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
    return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}
export async function productCycleAdvanceCommand(root, options, logger = console) {
    const to = options.to;
    if (!to || !isProductCycleStage(to)) {
        logger.error(colors.red(`Invalid or missing target stage: ${to ?? '<missing>'}`));
        logger.error(colors.gray('Valid stages: discover, rank, select, spec, build, verify, learn, complete, blocked'));
        return 2;
    }
    const result = advanceProductCycle({
        root,
        to,
        goal: options.goal,
        force: options.force,
    });
    if (options.json) {
        logger.log(JSON.stringify(result, null, 2));
    }
    else if (result.ok) {
        logger.log(colors.green(`Advanced product cycle${result.from ? `: ${result.from} -> ${result.to}` : ` to ${result.to}`}`));
        logger.log(renderSnapshot(result.snapshot));
    }
    else {
        logger.error(colors.red(`Cannot advance product cycle to ${result.to}`));
        for (const issue of result.issues) {
            logger.error(`  ${issue.severity}: ${issue.code}: ${issue.message}`);
        }
    }
    return result.ok ? 0 : 1;
}
export async function productCycleRunCommand(root, options, logger = console) {
    const stopAt = options.stopAt;
    if (stopAt && !isProductCycleStage(stopAt)) {
        logger.error(colors.red(`Invalid --stop-at stage: ${stopAt}`));
        return 2;
    }
    const report = runProductCycle({
        root,
        goal: options.goal,
        maxStages: options.maxStages,
        stopAt: stopAt,
        dryRun: options.dryRun,
        verifyCommand: options.verifyCommand,
    });
    if (options.json) {
        logger.log(JSON.stringify(report, null, 2));
    }
    else {
        logger.log(renderRunReport(report));
    }
    return report.ok ? 0 : 1;
}
function renderRunReport(report) {
    const lines = [];
    lines.push(colors.bold(`Product cycle runner — stopped: ${report.stoppedReason}`));
    if (report.startedFromStage) {
        lines.push(`Started from: ${report.startedFromStage}`);
    }
    if (report.endedAtStage) {
        lines.push(`Ended at: ${report.endedAtStage}`);
    }
    if (report.stagesAdvanced.length > 0) {
        lines.push('');
        lines.push(colors.bold('Stages advanced:'));
        for (const advance of report.stagesAdvanced) {
            lines.push(`  ${advance.from} -> ${advance.to}  (${advance.reason})`);
        }
    }
    if (report.stageResults.length > 0) {
        lines.push('');
        lines.push(colors.bold('Stage decisions:'));
        for (const result of report.stageResults) {
            lines.push(`  ${formatStageOutcome(result)}`);
            if (result.instruction) {
                lines.push(`    ${colors.gray('next:')} ${result.instruction}`);
            }
        }
    }
    if (report.pauseInstruction) {
        lines.push('');
        lines.push(colors.bold('Pause instruction:'));
        lines.push(`  ${report.pauseInstruction}`);
    }
    if (report.issues.length > 0) {
        lines.push('');
        lines.push(colors.bold('Issues:'));
        for (const issue of report.issues) {
            const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
            lines.push(`  ${marker} ${issue.code}: ${issue.message}`);
        }
    }
    return lines.join('\n');
}
function formatStageOutcome(result) {
    const verdictColor = result.outcome === 'advance'
        ? colors.green
        : result.outcome === 'verify-failed' || result.outcome === 'contract-failed'
            ? colors.red
            : colors.yellow;
    return `${verdictColor(result.outcome.padEnd(15))} ${result.stage}: ${result.reason}`;
}
function renderSnapshot(snapshot) {
    const rows = [
        { field: 'path', value: snapshot.path },
        { field: 'exists', value: String(snapshot.exists) },
        { field: 'cycle_id', value: snapshot.cycleId ?? '-' },
        { field: 'cycle_goal', value: snapshot.cycleGoal ?? '-' },
        { field: 'cycle_stage', value: snapshot.stage ?? '-' },
        { field: 'next_stage', value: snapshot.nextStage ?? '-' },
        { field: 'build_route', value: snapshot.buildRoute ?? '-' },
    ];
    const lines = [
        colors.bold('Product cycle FSM'),
        renderTable(rows, [
            { header: 'field', field: 'field', width: 14 },
            { header: 'value', field: 'value', width: 80 },
        ]),
        '',
        `${colors.bold('next_action')}: ${snapshot.nextAction}`,
    ];
    if (snapshot.issues.length > 0) {
        lines.push('');
        for (const issue of snapshot.issues) {
            const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
            lines.push(`${marker} ${issue.code}: ${issue.message}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=product-cycle.js.map
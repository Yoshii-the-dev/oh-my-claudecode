/**
 * `omc product-cycle` — runtime FSM for the product learning loop.
 */
import { colors, renderTable } from '../utils/formatting.js';
import { advanceProductCycle, getNextProductCycleAction, isProductCycleStage, validateProductCycle, } from '../../product/cycle-fsm.js';
import { runProductCycle, } from '../../product/cycle-runner.js';
import { PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH, readProductInterventionHandoff, } from '../../product/intervention-router.js';
import { buildProductInterventionExecutionPlan, PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH, readProductInterventionExecutionPlan, renderProductInterventionExecutionPlan, writeProductInterventionExecutionPlan, } from '../../product/intervention-execution-plan.js';
import { PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH, renderProductInterventionRunReport, runProductInterventionExecutionPlan, writeProductInterventionRunReport, } from '../../product/intervention-runner.js';
import { PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH, readProductResearchHandoff, } from '../../product/research-router.js';
import { buildProductResearchExecutionPlan, PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH, readProductResearchExecutionPlan, renderProductResearchExecutionPlan, writeProductResearchExecutionPlan, } from '../../product/research-execution-plan.js';
import { PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH, renderProductResearchRunReport, runProductResearchExecutionPlan, writeProductResearchRunReport, } from '../../product/research-runner.js';
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
export async function productCycleInterventionsCommand(root, options, logger = console) {
    const handoff = readProductInterventionHandoff(root);
    if (!handoff) {
        if (options.json) {
            logger.log(JSON.stringify({ exists: false, path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle interventions at ${PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH}`);
        }
        return 0;
    }
    if (options.json) {
        logger.log(JSON.stringify({ exists: true, path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH, handoff }, null, 2));
    }
    else {
        logger.log(renderInterventionHandoff(handoff));
    }
    return handoff.blocking_route_count > 0 ? 1 : 0;
}
export async function productCycleInterventionsPlanCommand(root, options, logger = console) {
    const handoff = readProductInterventionHandoff(root);
    if (!handoff) {
        if (options.json) {
            logger.log(JSON.stringify({
                exists: false,
                path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
                executionPlanPath: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
            }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle interventions at ${PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH}`);
        }
        return 0;
    }
    const plan = buildProductInterventionExecutionPlan(handoff, {
        provider: options.provider,
        sourceHandoff: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductInterventionExecutionPlan(root ?? process.cwd(), plan);
    if (options.json) {
        logger.log(JSON.stringify({
            exists: true,
            path: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
            written: written ?? null,
            plan,
        }, null, 2));
    }
    else {
        logger.log(renderInterventionExecutionPlan(plan, written));
    }
    return plan.steps.some((step) => !step.executable) ? 1 : 0;
}
export async function productCycleInterventionsRunCommand(root, options, logger = console) {
    const loaded = loadOrBuildInterventionExecutionPlan(root, options);
    if (!loaded.plan) {
        if (options.json) {
            logger.log(JSON.stringify({
                exists: false,
                path: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
                handoffPath: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
            }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle execution plan at ${PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH}`);
        }
        return 0;
    }
    const report = runProductInterventionExecutionPlan(loaded.plan, {
        root,
        dryRun: options.dryRun,
        maxSteps: options.maxSteps,
        waitForTeamJobs: options.wait,
        teamWaitTimeoutMs: options.waitTimeoutMs,
        sourcePlan: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductInterventionRunReport(root ?? process.cwd(), report);
    if (options.json) {
        logger.log(JSON.stringify({
            exists: true,
            path: PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH,
            planWritten: loaded.written ?? null,
            written: written ?? null,
            report,
        }, null, 2));
    }
    else {
        logger.log(renderInterventionRunReport(report, written, loaded.written));
    }
    return report.failed_step_count > 0 ? 1 : 0;
}
export async function productCycleResearchCommand(root, options, logger = console) {
    const handoff = readProductResearchHandoff(root);
    if (!handoff) {
        if (options.json) {
            logger.log(JSON.stringify({ exists: false, path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle research at ${PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH}`);
        }
        return 0;
    }
    if (options.json) {
        logger.log(JSON.stringify({ exists: true, path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH, handoff }, null, 2));
    }
    else {
        logger.log(renderResearchHandoff(handoff));
    }
    return handoff.blocking_route_count > 0 ? 1 : 0;
}
export async function productCycleResearchPlanCommand(root, options, logger = console) {
    const handoff = readProductResearchHandoff(root);
    if (!handoff) {
        if (options.json) {
            logger.log(JSON.stringify({
                exists: false,
                path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
                executionPlanPath: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
            }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle research at ${PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH}`);
        }
        return 0;
    }
    const plan = buildProductResearchExecutionPlan(handoff, {
        provider: options.provider,
        sourceHandoff: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductResearchExecutionPlan(root ?? process.cwd(), plan);
    if (options.json) {
        logger.log(JSON.stringify({
            exists: true,
            path: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
            written: written ?? null,
            plan,
        }, null, 2));
    }
    else {
        logger.log(renderResearchExecutionPlan(plan, written));
    }
    return plan.steps.some((step) => !step.executable) ? 1 : 0;
}
export async function productCycleResearchRunCommand(root, options, logger = console) {
    const loaded = loadOrBuildResearchExecutionPlan(root, options);
    if (!loaded.plan) {
        if (options.json) {
            logger.log(JSON.stringify({
                exists: false,
                path: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
                handoffPath: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
            }, null, 2));
        }
        else {
            logger.log(`No pending product-cycle research execution plan at ${PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH}`);
        }
        return 0;
    }
    const report = runProductResearchExecutionPlan(loaded.plan, {
        root,
        dryRun: options.dryRun,
        maxSteps: options.maxSteps,
        sourcePlan: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductResearchRunReport(root ?? process.cwd(), report);
    if (options.json) {
        logger.log(JSON.stringify({
            exists: true,
            path: PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH,
            planWritten: loaded.written ?? null,
            written: written ?? null,
            report,
        }, null, 2));
    }
    else {
        logger.log(renderResearchRunReport(report, written, loaded.written));
    }
    return report.failed_step_count > 0 ? 1 : 0;
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
            if (result.interventions && result.interventions.length > 0) {
                for (const route of result.interventions) {
                    const marker = route.required ? 'required' : 'recommended';
                    lines.push(`    ${colors.gray(marker)} ${route.agent}: ${route.command}`);
                }
            }
            if (result.research && result.research.length > 0) {
                for (const route of result.research) {
                    const marker = route.required ? 'required research' : 'recommended research';
                    lines.push(`    ${colors.gray(marker)} ${route.agent}: ${route.command}`);
                }
            }
        }
    }
    if (report.pauseInstruction) {
        lines.push('');
        lines.push(colors.bold('Pause instruction:'));
        lines.push(`  ${report.pauseInstruction}`);
    }
    if (report.interventionHandoff) {
        lines.push('');
        lines.push(colors.bold('Intervention handoff:'));
        lines.push(`  ${report.interventionHandoff.jsonPath}`);
    }
    if (report.researchHandoff) {
        lines.push('');
        lines.push(colors.bold('Research handoff:'));
        lines.push(`  ${report.researchHandoff.jsonPath}`);
    }
    if (report.interventionExecutionPlan) {
        lines.push('');
        lines.push(colors.bold('Intervention execution plan:'));
        lines.push(`  ${report.interventionExecutionPlan.jsonPath}`);
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
function renderInterventionHandoff(handoff) {
    const lines = [
        colors.bold('Product cycle interventions'),
        `cycle_stage: ${handoff.cycle_stage}`,
        `status: ${handoff.status}`,
        `blocking_route_count: ${handoff.blocking_route_count}`,
    ];
    if (handoff.next_command) {
        lines.push(`next_command: ${handoff.next_command}`);
    }
    if (handoff.routes.length > 0) {
        lines.push('');
        lines.push(colors.bold('Routes:'));
        for (const route of handoff.routes) {
            const marker = route.required ? 'required' : 'recommended';
            lines.push(`  ${marker} ${route.agent}: ${route.command}`);
            lines.push(`    ${colors.gray(route.trigger)}`);
        }
    }
    return lines.join('\n');
}
function renderResearchHandoff(handoff) {
    const lines = [
        colors.bold('Product cycle research'),
        `cycle_stage: ${handoff.cycle_stage}`,
        `status: ${handoff.status}`,
        `blocking_route_count: ${handoff.blocking_route_count}`,
        `research_artifact: ${handoff.research_artifact}`,
    ];
    if (handoff.next_command) {
        lines.push(`next_command: ${handoff.next_command}`);
    }
    if (handoff.routes.length > 0) {
        lines.push('');
        lines.push(colors.bold('Routes:'));
        for (const route of handoff.routes) {
            const marker = route.required ? 'required' : 'recommended';
            lines.push(`  ${marker} ${route.agent}: ${route.command}`);
            lines.push(`    ${colors.gray(route.trigger)}`);
        }
    }
    return lines.join('\n');
}
function renderResearchExecutionPlan(plan, written) {
    const rendered = renderProductResearchExecutionPlan(plan);
    if (!written)
        return rendered;
    return [
        rendered.trimEnd(),
        '',
        colors.bold('Research execution plan written:'),
        `  ${written.jsonPath}`,
        `  ${written.mdPath}`,
    ].join('\n');
}
function renderResearchRunReport(report, written, planWritten) {
    const lines = [renderProductResearchRunReport(report).trimEnd()];
    if (planWritten) {
        lines.push('', colors.bold('Research execution plan written:'), `  ${planWritten.jsonPath}`, `  ${planWritten.mdPath}`);
    }
    if (written) {
        lines.push('', colors.bold('Research run report written:'), `  ${written.jsonPath}`, `  ${written.mdPath}`);
    }
    return lines.join('\n');
}
function renderInterventionExecutionPlan(plan, written) {
    const rendered = renderProductInterventionExecutionPlan(plan);
    if (!written)
        return rendered;
    return [
        rendered.trimEnd(),
        '',
        colors.bold('Execution plan written:'),
        `  ${written.jsonPath}`,
        `  ${written.mdPath}`,
    ].join('\n');
}
function renderInterventionRunReport(report, written, planWritten) {
    const lines = [renderProductInterventionRunReport(report).trimEnd()];
    if (planWritten) {
        lines.push('', colors.bold('Execution plan written:'), `  ${planWritten.jsonPath}`, `  ${planWritten.mdPath}`);
    }
    if (written) {
        lines.push('', colors.bold('Run report written:'), `  ${written.jsonPath}`, `  ${written.mdPath}`);
    }
    return lines.join('\n');
}
function loadOrBuildInterventionExecutionPlan(root, options) {
    const existing = readProductInterventionExecutionPlan(root);
    if (existing)
        return { plan: existing };
    const handoff = readProductInterventionHandoff(root);
    if (!handoff)
        return {};
    const plan = buildProductInterventionExecutionPlan(handoff, {
        provider: options.provider,
        sourceHandoff: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductInterventionExecutionPlan(root ?? process.cwd(), plan);
    return { plan, written };
}
function loadOrBuildResearchExecutionPlan(root, options) {
    const existing = readProductResearchExecutionPlan(root);
    if (existing)
        return { plan: existing };
    const handoff = readProductResearchHandoff(root);
    if (!handoff)
        return {};
    const plan = buildProductResearchExecutionPlan(handoff, {
        provider: options.provider,
        sourceHandoff: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
    });
    const written = options.dryRun ? undefined : writeProductResearchExecutionPlan(root ?? process.cwd(), plan);
    return { plan, written };
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
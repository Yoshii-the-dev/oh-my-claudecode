import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { advanceProductCycle, readProductCycle, } from './cycle-fsm.js';
import { validateProductPipelineContracts } from './pipeline-contract-validator.js';
import { readPortfolioLedger, validatePortfolioLedger } from './portfolio-ledger.js';
const DEFAULT_VERIFY_COMMAND = 'npm test';
const DEFAULT_MAX_STAGES = 10;
const STAGE_ORDER = ['discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn', 'complete'];
const NEXT_STAGE = {
    discover: 'rank',
    rank: 'select',
    select: 'spec',
    spec: 'build',
    build: 'verify',
    verify: 'learn',
    learn: 'complete',
};
export function runProductCycle(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const dryRun = options.dryRun === true;
    const maxStages = options.maxStages ?? DEFAULT_MAX_STAGES;
    const verifyCommand = options.verifyCommand ?? DEFAULT_VERIFY_COMMAND;
    const stopAt = options.stopAt;
    const startedAt = new Date().toISOString();
    const stagesAdvanced = [];
    const stageResults = [];
    const issues = [];
    let snapshot = readProductCycle(root);
    if (!snapshot.exists) {
        if (!options.goal) {
            return finalize({
                ok: false,
                startedAt,
                stoppedReason: 'missing-goal',
                pauseInstruction: 'No active cycle. Pass --goal "<cycle goal>" to bootstrap.',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        if (dryRun) {
            stageResults.push({
                stage: 'discover',
                outcome: 'pause-for-human',
                reason: 'dry-run: would create new cycle at discover',
                instruction: `omc product-cycle advance --to discover --goal "${options.goal}"`,
            });
            return finalize({
                ok: true,
                startedAt,
                stoppedReason: 'pause-for-human',
                pauseInstruction: stageResults[0]?.instruction,
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        const bootstrap = advanceProductCycle({ root, to: 'discover', goal: options.goal });
        if (!bootstrap.ok) {
            issues.push(...bootstrap.issues);
            return finalize({
                ok: false,
                startedAt,
                stoppedReason: 'contract-failed',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        snapshot = bootstrap.snapshot;
    }
    const startedFromStage = snapshot.stage;
    let stagesProcessed = 0;
    while (snapshot.stage && stagesProcessed < maxStages) {
        const currentStage = snapshot.stage;
        if (currentStage === 'complete') {
            return finalize({
                ok: true,
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: 'complete',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        if (currentStage === 'blocked') {
            return finalize({
                ok: false,
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: 'blocked',
                pauseInstruction: 'Cycle is blocked. Resolve blocking_issues before advancing.',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        if (stopAt === currentStage && stagesAdvanced.length > 0) {
            return finalize({
                ok: true,
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: 'stop-at',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        const evaluation = evaluateStage(currentStage, snapshot, root, verifyCommand);
        stageResults.push(evaluation);
        if (evaluation.outcome !== 'advance') {
            const reason = evaluation.outcome === 'verify-failed'
                ? 'verify-failed'
                : evaluation.outcome === 'contract-failed'
                    ? 'contract-failed'
                    : evaluation.outcome === 'pause-for-human'
                        ? 'pause-for-human'
                        : 'pause-for-llm';
            return finalize({
                ok: reason === 'pause-for-human' || reason === 'pause-for-llm',
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: reason,
                pauseInstruction: evaluation.instruction,
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        const nextStage = NEXT_STAGE[currentStage];
        if (!nextStage) {
            return finalize({
                ok: true,
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: 'complete',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        if (dryRun) {
            stagesAdvanced.push({ from: currentStage, to: nextStage, reason: `[dry-run] ${evaluation.reason}` });
            const projected = STAGE_ORDER.indexOf(nextStage);
            if (projected < 0)
                break;
            snapshot = { ...snapshot, stage: nextStage };
            stagesProcessed += 1;
            continue;
        }
        const advance = advanceProductCycle({ root, to: nextStage });
        if (!advance.ok) {
            issues.push(...advance.issues);
            return finalize({
                ok: false,
                startedAt,
                startedFromStage,
                endedAtStage: currentStage,
                stoppedReason: 'contract-failed',
                stagesAdvanced,
                stageResults,
                issues,
            });
        }
        stagesAdvanced.push({ from: currentStage, to: nextStage, reason: evaluation.reason });
        snapshot = advance.snapshot;
        stagesProcessed += 1;
    }
    return finalize({
        ok: true,
        startedAt,
        startedFromStage,
        endedAtStage: snapshot.stage,
        stoppedReason: 'max-stages',
        pauseInstruction: `Reached max-stages (${maxStages}) before completion. Re-run to continue.`,
        stagesAdvanced,
        stageResults,
        issues,
    });
}
function evaluateStage(stage, snapshot, root, verifyCommand) {
    switch (stage) {
        case 'discover':
            return evaluateDiscover(root);
        case 'rank':
            return evaluateRank(root);
        case 'select':
            return evaluateSelect(root, snapshot.cycleId);
        case 'spec':
            return evaluateSpec(root);
        case 'build':
            return evaluateBuild(snapshot);
        case 'verify':
            return evaluateVerify(root, verifyCommand);
        case 'learn':
            return evaluateLearn(root);
        default:
            return {
                stage,
                outcome: 'pause-for-human',
                reason: `Unknown stage: ${stage}`,
            };
    }
}
function evaluateDiscover(root) {
    const capabilityPath = '.omc/product/capability-map/current.md';
    const ecosystemPath = '.omc/ecosystem/current.md';
    const expected = [
        { path: capabilityPath, exists: existsSync(resolve(root, capabilityPath)) },
        { path: ecosystemPath, exists: existsSync(resolve(root, ecosystemPath)) },
    ];
    if (expected[0].exists) {
        return {
            stage: 'discover',
            outcome: 'advance',
            reason: 'capability map present',
            expectedArtifacts: expected,
        };
    }
    return {
        stage: 'discover',
        outcome: 'pause-for-llm',
        reason: 'capability map missing',
        instruction: '/product-foundation "<cycle goal>" --foundation-lite',
        expectedArtifacts: expected,
    };
}
function evaluateRank(root) {
    const opportunities = '.omc/opportunities/current.md';
    const ledger = '.omc/portfolio/current.json';
    const roadmap = '.omc/roadmap/current.md';
    const expected = [
        { path: opportunities, exists: existsSync(resolve(root, opportunities)) },
        { path: roadmap, exists: existsSync(resolve(root, roadmap)) },
        { path: ledger, exists: existsSync(resolve(root, ledger)) },
    ];
    const missing = expected.filter((entry) => !entry.exists).map((entry) => entry.path);
    if (missing.length > 0) {
        return {
            stage: 'rank',
            outcome: 'pause-for-llm',
            reason: `missing: ${missing.join(', ')}`,
            instruction: '/priority-engine "<cycle goal>"',
            expectedArtifacts: expected,
        };
    }
    const handoff = validateProductPipelineContracts({ root, stage: 'priority-handoff' });
    if (!handoff.ok) {
        return {
            stage: 'rank',
            outcome: 'contract-failed',
            reason: 'priority-handoff contract failed',
            instruction: 'omc doctor product-contracts --stage priority-handoff',
            evidence: { issues: handoff.issues },
        };
    }
    return {
        stage: 'rank',
        outcome: 'advance',
        reason: 'priority-handoff contract ok',
        expectedArtifacts: expected,
    };
}
function evaluateSelect(root, cycleId) {
    const ledgerReport = validatePortfolioLedger(root);
    if (!ledgerReport.ok || !ledgerReport.ledger) {
        return {
            stage: 'select',
            outcome: 'contract-failed',
            reason: ledgerReport.issues[0]?.message ?? 'portfolio ledger invalid',
            instruction: 'omc portfolio validate',
            evidence: { issues: ledgerReport.issues },
        };
    }
    const ledger = ledgerReport.ledger;
    const cycleItems = cycleId
        ? ledger.items.filter((item) => item.selected_cycle === cycleId)
        : ledger.items.filter((item) => item.status === 'selected');
    const hasCore = cycleItems.some((item) => item.type === 'core-product-slice');
    const hasEnabling = cycleItems.some((item) => item.type === 'enabling');
    const hasLearning = cycleItems.some((item) => item.type === 'learning' || item.type === 'research');
    if (hasCore && hasEnabling && hasLearning) {
        return {
            stage: 'select',
            outcome: 'advance',
            reason: '1 core + 1 enabling + 1 learning selected',
            evidence: { selectedItems: cycleItems.map((item) => ({ id: item.id, type: item.type })) },
        };
    }
    const missing = [];
    if (!hasCore)
        missing.push('core-product-slice');
    if (!hasEnabling)
        missing.push('enabling');
    if (!hasLearning)
        missing.push('learning/research');
    return {
        stage: 'select',
        outcome: 'pause-for-human',
        reason: `selected portfolio missing: ${missing.join(', ')}`,
        instruction: 'Mark portfolio items as selected for the active cycle in .omc/portfolio/current.json (set selected_cycle and status=selected)',
        evidence: { missing, currentSelection: cycleItems.map((item) => item.id) },
    };
}
function evaluateSpec(root) {
    const cycleReport = validateProductPipelineContracts({ root, stage: 'cycle' });
    if (cycleReport.ok) {
        return {
            stage: 'spec',
            outcome: 'advance',
            reason: 'cycle contract ok',
        };
    }
    return {
        stage: 'spec',
        outcome: 'contract-failed',
        reason: 'cycle contract failed',
        instruction: 'omc doctor product-contracts --stage cycle',
        evidence: { issues: cycleReport.issues },
    };
}
function evaluateBuild(snapshot) {
    const route = (snapshot.buildRoute ?? '').toLowerCase();
    const command = route === 'backend-pipeline'
        ? '/backend-pipeline "<enabling task>"'
        : route === 'both'
            ? '/backend-pipeline "<enabling task>" then /product-pipeline "<core product slice>"'
            : '/product-pipeline "<core product slice>"';
    return {
        stage: 'build',
        outcome: 'pause-for-llm',
        reason: `build_route=${route || 'unknown'} requires LLM-driven pipeline`,
        instruction: command,
    };
}
function evaluateVerify(root, verifyCommand) {
    const trimmed = verifyCommand.trim();
    if (!trimmed || trimmed.toLowerCase() === 'skip') {
        return {
            stage: 'verify',
            outcome: 'pause-for-human',
            reason: 'verify command disabled (--verify-command skip)',
            instruction: 'Run cycle-specific tests/audits manually, then omc product-cycle advance --to learn',
        };
    }
    const result = spawnSync(trimmed, {
        cwd: root,
        shell: true,
        stdio: 'pipe',
        encoding: 'utf-8',
    });
    if (result.error) {
        return {
            stage: 'verify',
            outcome: 'verify-failed',
            reason: `verify command error: ${result.error.message}`,
            instruction: trimmed,
            evidence: { command: trimmed, error: String(result.error) },
        };
    }
    if (result.status === 0) {
        return {
            stage: 'verify',
            outcome: 'advance',
            reason: `verify passed (${trimmed})`,
            evidence: { command: trimmed, exitCode: 0 },
        };
    }
    return {
        stage: 'verify',
        outcome: 'verify-failed',
        reason: `verify failed (${trimmed}, exit ${result.status})`,
        instruction: trimmed,
        evidence: {
            command: trimmed,
            exitCode: result.status,
            stderr: truncate(result.stderr ?? ''),
            stdout: truncate(result.stdout ?? ''),
        },
    };
}
function evaluateLearn(root) {
    const learningPath = resolve(root, '.omc/learning/current.md');
    const expected = [{ path: '.omc/learning/current.md', exists: existsSync(learningPath) }];
    if (!expected[0].exists) {
        return {
            stage: 'learn',
            outcome: 'pause-for-llm',
            reason: 'learning capture missing',
            instruction: 'Write .omc/learning/current.md with shipped outcome, evidence collected, user/product learning, invalidated assumptions, recommended next cycle.',
            expectedArtifacts: expected,
        };
    }
    const content = readFileSync(learningPath, 'utf-8').toLowerCase();
    const required = ['shipped outcome', 'evidence collected', 'user/product learning', 'invalidated assumptions', 'recommended next cycle'];
    const missing = required.filter((term) => !content.includes(term));
    if (missing.length > 0) {
        return {
            stage: 'learn',
            outcome: 'pause-for-llm',
            reason: `learning capture missing required sections: ${missing.join(', ')}`,
            instruction: 'Add the missing sections to .omc/learning/current.md',
            expectedArtifacts: expected,
        };
    }
    // Touch the ledger to surface a portfolio sanity check (advisory only).
    void readPortfolioLedger(root);
    return {
        stage: 'learn',
        outcome: 'advance',
        reason: 'learning capture complete',
        expectedArtifacts: expected,
    };
}
function truncate(value, max = 600) {
    return value.length > max ? `${value.slice(0, max)}...` : value;
}
function finalize(report) {
    return report;
}
//# sourceMappingURL=cycle-runner.js.map
const DEFAULT_MAX_ATTEMPTS = 3;
export function decideAutoAction(input) {
    if (input.policy === 'off') {
        return decision('ask_user', 'auto-disabled', 'Auto policy is off.', input.plan);
    }
    if (input.terminal) {
        return decision('stop', 'terminal', 'Cycle is already terminal.', input.plan);
    }
    if (input.humanGate) {
        return decision('ask_user', 'human-gate', 'Human decision is required before continuing.', input.plan);
    }
    if (input.missingDependency) {
        return decision('block', 'missing-dependency', 'Required tool or dependency is missing; install/provision approval is required.', input.plan);
    }
    const attempts = input.attemptCount ?? 0;
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (attempts >= maxAttempts) {
        return decision('block', 'max-attempts', `Auto policy reached max attempts (${maxAttempts}).`, input.plan);
    }
    if (input.repeatedFailure) {
        return decision('block', 'repeated-failure', 'The same automatic action failed repeatedly.', input.plan);
    }
    const steps = input.plan?.steps ?? [];
    if (steps.length === 0) {
        return decision('ask_user', 'no-action', 'No executable handoff steps are available.', input.plan);
    }
    const isSafe = input.safeStepPredicate ?? defaultSafeStepPredicate;
    const blocked = steps.filter((step) => !isSafe(step));
    if (blocked.length > 0) {
        return {
            action: 'block',
            reason: 'unsafe-step',
            message: `Unsafe or manual steps require user review: ${blocked.map((step) => step.route_id).join(', ')}`,
            runnableStepCount: steps.length - blocked.length,
            blockedStepIds: blocked.map((step) => step.route_id),
        };
    }
    return decision('run', 'safe-executable', 'All handoff steps are safe executable surfaces.', input.plan);
}
export function buildAutoAttemptKey(stage, kind) {
    return `${stage ?? 'unknown'}:${kind}`;
}
function defaultSafeStepPredicate(step) {
    if (!step.executable || !step.argv || step.argv.length === 0)
        return false;
    return step.execution_surface === 'agent-prompt'
        || step.execution_surface === 'team-start';
}
function decision(action, reason, message, plan) {
    return {
        action,
        reason,
        message,
        runnableStepCount: plan?.steps.length ?? 0,
        blockedStepIds: [],
    };
}
//# sourceMappingURL=auto-decision.js.map
/**
 * Continuation Enforcement Feature
 *
 * Provides a prompt-level completion contract and a small runtime gate for
 * hook contexts that include task/todo state.
 */

import type { HookDefinition, HookContext, HookResult } from '../shared/types.js';
import { getBackgroundTaskGuidance, DEFAULT_MAX_BACKGROUND_TASKS } from './background-tasks.js';

export interface CompletionGateTask {
  id?: string;
  status?: string;
  blocker?: {
    reason?: string;
    evidence?: string;
    next_required_action?: string;
    nextRequiredAction?: string;
  };
  evidence?: string;
  next_required_action?: string;
  nextRequiredAction?: string;
}

export interface CompletionVerificationEvidence {
  command?: string;
  result?: string;
  evidence?: string;
}

export interface CompletionGateInput {
  tasks?: CompletionGateTask[];
  todos?: CompletionGateTask[];
  backgroundTasks?: CompletionGateTask[];
  verification?: CompletionVerificationEvidence[];
  requireVerification?: boolean;
}

export interface CompletionGateResult {
  status: 'passed' | 'blocked' | 'needs_action';
  canStop: boolean;
  pendingTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  failedTasks: number;
  unknownTasks: number;
  unverifiedBlockedTasks: number;
  verification: CompletionVerificationEvidence[];
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTaskList(value: unknown): CompletionGateTask[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => item as CompletionGateTask);
}

function normalizeVerification(value: unknown): CompletionVerificationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => item as CompletionVerificationEvidence);
}

function normalizeStatus(status: string | undefined): string {
  return String(status || 'unknown')
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function hasSubstantiatedBlocker(task: CompletionGateTask): boolean {
  const blocker = task.blocker || {};
  const reason = blocker.reason;
  const evidence = blocker.evidence || task.evidence;
  const nextAction =
    blocker.next_required_action ||
    blocker.nextRequiredAction ||
    task.next_required_action ||
    task.nextRequiredAction;

  return Boolean(reason && evidence && nextAction);
}

function extractCompletionGateInput(context: HookContext): CompletionGateInput | undefined {
  const candidates = [context.toolInput, context.toolOutput];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;

    const nestedGate = candidate.completionGate || candidate.completion_gate;
    if (isRecord(nestedGate)) {
      const nestedInput = normalizeCompletionGateInput(nestedGate);
      if (nestedInput) return nestedInput;
    }

    const input = normalizeCompletionGateInput(candidate);
    if (input) return input;
  }

  return undefined;
}

function normalizeCompletionGateInput(record: Record<string, unknown>): CompletionGateInput | undefined {
  const tasks =
    normalizeTaskList(record.tasks) ||
    normalizeTaskList(record.todos) ||
    normalizeTaskList(record.backgroundTasks);

  if (!tasks) return undefined;

  return {
    tasks,
    verification: normalizeVerification(record.verification),
    requireVerification: record.requireVerification === true
  };
}

export function evaluateCompletionGate(input?: CompletionGateInput): CompletionGateResult {
  const tasks = input?.tasks || input?.todos || input?.backgroundTasks || [];
  const verification = input?.verification || [];
  const reasons: string[] = [];

  let pendingTasks = 0;
  let inProgressTasks = 0;
  let blockedTasks = 0;
  let failedTasks = 0;
  let unknownTasks = 0;
  let unverifiedBlockedTasks = 0;

  for (const task of tasks) {
    const status = normalizeStatus(task.status);
    if (status === 'pending' || status === 'queued' || status === 'todo') {
      pendingTasks += 1;
    } else if (status === 'in_progress' || status === 'running' || status === 'active') {
      inProgressTasks += 1;
    } else if (status === 'blocked') {
      blockedTasks += 1;
      if (!hasSubstantiatedBlocker(task)) {
        unverifiedBlockedTasks += 1;
      }
    } else if (status === 'failed' || status === 'error') {
      failedTasks += 1;
    } else if (status !== 'completed' && status !== 'done') {
      unknownTasks += 1;
    }
  }

  if (pendingTasks > 0) reasons.push(`${pendingTasks} pending task(s)`);
  if (inProgressTasks > 0) reasons.push(`${inProgressTasks} in-progress task(s)`);
  if (failedTasks > 0) reasons.push(`${failedTasks} failed task(s)`);
  if (unknownTasks > 0) reasons.push(`${unknownTasks} task(s) with unknown status`);
  if (unverifiedBlockedTasks > 0) {
    reasons.push(`${unverifiedBlockedTasks} blocked task(s) without reason, evidence, and next_required_action`);
  }
  if (input?.requireVerification && verification.length === 0) {
    reasons.push('verification evidence is required but missing');
  }

  if (reasons.length > 0) {
    return {
      status: 'needs_action',
      canStop: false,
      pendingTasks,
      inProgressTasks,
      blockedTasks,
      failedTasks,
      unknownTasks,
      unverifiedBlockedTasks,
      verification,
      reasons
    };
  }

  return {
    status: blockedTasks > 0 ? 'blocked' : 'passed',
    canStop: true,
    pendingTasks,
    inProgressTasks,
    blockedTasks,
    failedTasks,
    unknownTasks,
    unverifiedBlockedTasks,
    verification,
    reasons
  };
}

function formatCompletionGateMessage(result: CompletionGateResult): string {
  const payload = {
    completion_gate: {
      status: result.status,
      can_stop: result.canStop,
      pending_tasks: result.pendingTasks,
      in_progress_tasks: result.inProgressTasks,
      blocked_tasks: result.blockedTasks,
      failed_tasks: result.failedTasks,
      unknown_tasks: result.unknownTasks,
      unverified_blocked_tasks: result.unverifiedBlockedTasks,
      verification: result.verification,
      reasons: result.reasons
    }
  };

  return (
    `[completion-gate] Stop is deferred because the completion gate did not pass.\n\n` +
    `${JSON.stringify(payload, null, 2)}\n\n` +
    `Continue with the next actionable task, or convert true blockers into blocked tasks with reason, evidence, and next_required_action.`
  );
}

/**
 * Create a continuation enforcement hook
 *
 * This hook evaluates task state when the hook payload includes todos/tasks.
 * Missing task state is fail-open because other runtime hooks may own the
 * canonical state.
 */
export function createContinuationHook(): HookDefinition {
  return {
    event: 'Stop',
    handler: async (context: HookContext): Promise<HookResult> => {
      const gateInput = extractCompletionGateInput(context);
      if (!gateInput) {
        return { continue: true };
      }

      const gate = evaluateCompletionGate(gateInput);
      if (!gate.canStop) {
        return {
          continue: true,
          message: formatCompletionGateMessage(gate)
        };
      }

      return {
        continue: true
      };
    }
  };
}

/**
 * System prompt addition for continuation enforcement
 */
export const continuationSystemPromptAddition = `
## Completion Gate

Before concluding, evaluate the current task state and verification evidence.

A final response is allowed when:
- no task is \`pending\` or \`in_progress\`;
- failed tasks are fixed or converted into substantiated blockers;
- each true blocker includes \`reason\`, \`evidence\`, and \`next_required_action\`;
- applicable build, lint, typecheck, test, or manual verification evidence has been collected.

Use this report shape internally and summarize it concisely for the user:

\`\`\`json
{
  "completion_gate": {
    "status": "passed | blocked | needs_action",
    "pending_tasks": 0,
    "in_progress_tasks": 0,
    "blocked_tasks": 0,
    "verification": [
      {
        "command": "npm test -- --run ...",
        "result": "passed",
        "evidence": "70 tests passed"
      }
    ]
  }
}
\`\`\`

If the gate is \`needs_action\`, continue with the next actionable task instead of claiming completion. If the gate is \`blocked\`, report the blocker with evidence and the exact next required action.

${getBackgroundTaskGuidance(DEFAULT_MAX_BACKGROUND_TASKS)}
`;

/**
 * Check prompt for signals that all work is done
 */
export function detectCompletionSignals(response: string): {
  claimed: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
} {
  const completionPatterns = [/all (?:tasks?|work|items?) (?:are |is )?(?:now )?(?:complete|done|finished)/i, /I(?:'ve| have) (?:completed|finished|done) (?:all|everything)/i, /everything (?:is|has been) (?:complete|done|finished)/i, /no (?:more|remaining|outstanding) (?:tasks?|work|items?)/i];

  const uncertaintyPatterns = [/(?:should|might|could) (?:be|have)/i, /I think|I believe|probably|maybe/i, /unless|except|but/i];

  const hasCompletion = completionPatterns.some((p) => p.test(response));
  const hasUncertainty = uncertaintyPatterns.some((p) => p.test(response));

  if (!hasCompletion) {
    return {
      claimed: false,
      confidence: 'high',
      reason: 'No completion claim detected'
    };
  }

  if (hasUncertainty) {
    return {
      claimed: true,
      confidence: 'low',
      reason: 'Completion claimed with uncertainty language'
    };
  }

  return {
    claimed: true,
    confidence: 'high',
    reason: 'Clear completion claim detected'
  };
}

/**
 * Generate a verification prompt to ensure work is complete
 */
export function generateVerificationPrompt(taskSummary: string): string {
  return `Before concluding, please verify the following:

1. Review your todo list - are ALL items marked complete?
2. Have you addressed: ${taskSummary}
3. Are there any errors or issues remaining?
4. Does the implementation meet the original requirements?

If everything is truly complete, confirm by saying "All tasks verified complete."
If anything remains, continue working on it.`;
}

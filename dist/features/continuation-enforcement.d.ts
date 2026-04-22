/**
 * Continuation Enforcement Feature
 *
 * Provides a prompt-level completion contract and a small runtime gate for
 * hook contexts that include task/todo state.
 */
import type { HookDefinition } from '../shared/types.js';
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
export declare function evaluateCompletionGate(input?: CompletionGateInput): CompletionGateResult;
/**
 * Create a continuation enforcement hook
 *
 * This hook evaluates task state when the hook payload includes todos/tasks.
 * Missing task state is fail-open because other runtime hooks may own the
 * canonical state.
 */
export declare function createContinuationHook(): HookDefinition;
/**
 * System prompt addition for continuation enforcement
 */
export declare const continuationSystemPromptAddition: string;
/**
 * Check prompt for signals that all work is done
 */
export declare function detectCompletionSignals(response: string): {
    claimed: boolean;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
};
/**
 * Generate a verification prompt to ensure work is complete
 */
export declare function generateVerificationPrompt(taskSummary: string): string;
//# sourceMappingURL=continuation-enforcement.d.ts.map
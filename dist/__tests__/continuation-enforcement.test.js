import { describe, expect, it } from 'vitest';
import { createContinuationHook, evaluateCompletionGate, continuationSystemPromptAddition } from '../features/continuation-enforcement.js';
describe('completion gate', () => {
    it('passes when every task is completed', () => {
        const result = evaluateCompletionGate({
            tasks: [
                { id: '1', status: 'completed' },
                { id: '2', status: 'done' }
            ],
            verification: [{ command: 'npm test', result: 'passed', evidence: 'tests passed' }]
        });
        expect(result.canStop).toBe(true);
        expect(result.status).toBe('passed');
        expect(result.reasons).toEqual([]);
    });
    it('blocks completion when tasks are pending or in progress', () => {
        const result = evaluateCompletionGate({
            tasks: [
                { id: '1', status: 'completed' },
                { id: '2', status: 'pending' },
                { id: '3', status: 'in_progress' }
            ]
        });
        expect(result.canStop).toBe(false);
        expect(result.status).toBe('needs_action');
        expect(result.pendingTasks).toBe(1);
        expect(result.inProgressTasks).toBe(1);
        expect(result.reasons).toEqual(['1 pending task(s)', '1 in-progress task(s)']);
    });
    it('allows a substantiated blocker as a terminal blocked state', () => {
        const result = evaluateCompletionGate({
            tasks: [
                {
                    id: 'blocked-1',
                    status: 'blocked',
                    blocker: {
                        reason: 'External credentials are required',
                        evidence: 'API returned 401 with test account',
                        next_required_action: 'User must provide a valid test token'
                    }
                }
            ]
        });
        expect(result.canStop).toBe(true);
        expect(result.status).toBe('blocked');
        expect(result.blockedTasks).toBe(1);
        expect(result.unverifiedBlockedTasks).toBe(0);
    });
    it('rejects blocked tasks that do not include evidence and next action', () => {
        const result = evaluateCompletionGate({
            tasks: [
                {
                    id: 'blocked-1',
                    status: 'blocked',
                    blocker: {
                        reason: 'External credentials are required'
                    }
                }
            ]
        });
        expect(result.canStop).toBe(false);
        expect(result.status).toBe('needs_action');
        expect(result.unverifiedBlockedTasks).toBe(1);
        expect(result.reasons).toContain('1 blocked task(s) without reason, evidence, and next_required_action');
    });
    it('Stop hook emits a deterministic gate report when task state is incomplete', async () => {
        const hook = createContinuationHook();
        const result = await hook.handler?.({
            toolInput: {
                todos: [
                    { id: '1', status: 'completed' },
                    { id: '2', status: 'pending' }
                ]
            }
        });
        expect(result?.continue).toBe(true);
        expect(result?.message).toContain('[completion-gate]');
        expect(result?.message).toContain('"pending_tasks": 1');
    });
    it('system prompt uses gate language instead of motivational enforcement language', () => {
        expect(continuationSystemPromptAddition).toContain('## Completion Gate');
        expect(continuationSystemPromptAddition).toContain('"completion_gate"');
        expect(continuationSystemPromptAddition).not.toMatch(/BOULDER|SACRED|OATH|LYING|BOUND/);
    });
});
//# sourceMappingURL=continuation-enforcement.test.js.map
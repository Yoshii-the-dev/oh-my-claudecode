/**
 * High-level telemetry emit helpers
 *
 * Each helper auto-populates base attribution + the appropriate context-specific
 * hash via version-attribution.ts. Callers MUST NOT pass attribution fields.
 */
import { emit, flush as writerFlush } from './writer.js';
export async function emitToolCall(options) {
    const { directory, session_id, run_id, agent_id, hook_name, tool_name, event, ...rest } = options;
    await emit({
        directory,
        stream: 'hook-events',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            hook_name,
            tool_name,
            event,
            ...rest,
        },
    });
}
export async function emitAgentHandoff(options) {
    const { directory, session_id, run_id, agent_id, kind, agent_type, parent_agent_id, model, ...rest } = options;
    await emit({
        directory,
        stream: 'agent-handoff',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            event: kind,
            agent_type,
            ...(parent_agent_id !== undefined ? { parent_agent_id } : {}),
            ...(model !== undefined ? { model } : {}),
            ...rest,
        },
    });
}
export async function emitLlmInteraction(options) {
    const { directory, session_id, run_id, agent_id, provider, model, tokens_in, tokens_out, ...rest } = options;
    await emit({
        directory,
        stream: 'llm-interaction',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            provider,
            model,
            tokens_in,
            tokens_out,
            ...rest,
        },
    });
}
export async function emitHookEvent(options) {
    const { directory, session_id, run_id, agent_id, hook_name, event, ...rest } = options;
    await emit({
        directory,
        stream: 'hook-events',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            hook_name,
            event,
            ...rest,
        },
    });
}
export async function emitProductCycleEvent(options) {
    const { directory, session_id, run_id, agent_id, event, cycle_id, cycle_stage, cycle_goal, ...rest } = options;
    await emit({
        directory,
        stream: 'product-cycle-events',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            event,
            ...(cycle_id !== undefined ? { cycle_id } : {}),
            ...(cycle_stage !== undefined ? { cycle_stage } : {}),
            ...(cycle_goal !== undefined ? { cycle_goal } : {}),
            ...rest,
        },
    });
}
export async function emitVerdict(options) {
    const { directory, session_id, run_id, agent_id, agent_type, verdict, duration_ms, tokens_in, tokens_out, reason, ...rest } = options;
    await emit({
        directory,
        stream: 'verdict',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            event: 'verdict',
            agent_type,
            verdict,
            ...(duration_ms !== undefined ? { duration_ms } : {}),
            ...(tokens_in !== undefined ? { tokens_in } : {}),
            ...(tokens_out !== undefined ? { tokens_out } : {}),
            ...(reason !== undefined ? { reason } : {}),
            ...rest,
        },
    });
}
export async function emitUserCorrection(options) {
    const { directory, session_id, run_id, agent_id, matched_pattern, prompt_hash, ...rest } = options;
    await emit({
        directory,
        stream: 'hook-events',
        payload: {
            ...(session_id !== undefined ? { session_id } : {}),
            ...(run_id !== undefined ? { run_id } : {}),
            ...(agent_id !== undefined ? { agent_id } : {}),
            hook_name: 'bridge',
            event: 'user_correction',
            matched_pattern,
            prompt_hash,
            ...rest,
        },
    });
}
// ---------------------------------------------------------------------------
// flush — re-export from writer
// ---------------------------------------------------------------------------
export { writerFlush as flush };
//# sourceMappingURL=emit.js.map
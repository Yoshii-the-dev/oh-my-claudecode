/**
 * High-level telemetry emit helpers
 *
 * Each helper auto-populates base attribution + the appropriate context-specific
 * hash via version-attribution.ts. Callers MUST NOT pass attribution fields.
 */
import { flush as writerFlush } from './writer.js';
export interface EmitBaseContext {
    /** Project root directory */
    directory: string;
    session_id?: string;
    run_id?: string;
    agent_id?: string;
}
export interface EmitToolCallOptions extends EmitBaseContext {
    hook_name: string;
    tool_name: string;
    /** 'allowed' | 'denied' | 'invoked' | 'completed' */
    event: string;
    latency_ms?: number;
    success?: boolean;
    [key: string]: unknown;
}
export declare function emitToolCall(options: EmitToolCallOptions): Promise<void>;
export interface EmitAgentHandoffOptions extends EmitBaseContext {
    kind: 'start' | 'end';
    agent_type: string;
    parent_agent_id?: string;
    model?: string;
    [key: string]: unknown;
}
export declare function emitAgentHandoff(options: EmitAgentHandoffOptions): Promise<void>;
export interface EmitLlmInteractionOptions extends EmitBaseContext {
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    cache_read?: number;
    cache_write?: number;
    latency_ms?: number;
    [key: string]: unknown;
}
export declare function emitLlmInteraction(options: EmitLlmInteractionOptions): Promise<void>;
export interface EmitHookEventOptions extends EmitBaseContext {
    hook_name: string;
    event: string;
    [key: string]: unknown;
}
export declare function emitHookEvent(options: EmitHookEventOptions): Promise<void>;
export interface EmitProductCycleEventOptions extends EmitBaseContext {
    event: string;
    cycle_id?: string;
    cycle_stage?: string;
    cycle_goal?: string;
    [key: string]: unknown;
}
export declare function emitProductCycleEvent(options: EmitProductCycleEventOptions): Promise<void>;
export interface EmitVerdictOptions extends EmitBaseContext {
    agent_type: string;
    verdict: string;
    duration_ms?: number;
    tokens_in?: number;
    tokens_out?: number;
    reason?: string;
    [key: string]: unknown;
}
export declare function emitVerdict(options: EmitVerdictOptions): Promise<void>;
export interface EmitUserCorrectionOptions extends EmitBaseContext {
    matched_pattern: string;
    prompt_hash: string;
    [key: string]: unknown;
}
export declare function emitUserCorrection(options: EmitUserCorrectionOptions): Promise<void>;
export { writerFlush as flush };
//# sourceMappingURL=emit.d.ts.map
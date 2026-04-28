/**
 * Telemetry Schemas
 *
 * Zod-validated event envelopes for every telemetry stream.
 * All envelopes include mandatory version attribution fields (Section 11).
 * schema_version: 1 is the only currently accepted value.
 *
 * Validation rules (per plan Section 6):
 * - Unknown fields are rejected (Zod strict mode).
 * - Missing mandatory base fields → stderr warning + event dropped (handled in writer).
 * - schema_version: 1 is the only accepted value.
 */
import { z } from 'zod';
export type StreamName = 'agent-handoff' | 'verdict' | 'skill-events' | 'hook-events' | 'llm-interaction' | 'product-cycle-events';
/**
 * Base envelope — mandatory on every event in every stream.
 * Auto-populated by writer.ts; callers must NOT pass attribution fields.
 */
export interface BaseEnvelope {
    schema_version: 1;
    stream: StreamName;
    /** ISO-8601 UTC, ms precision */
    ts: string;
    session_id?: string;
    run_id?: string;
    agent_id?: string;
    /** package.json `version` field */
    plugin_version: string;
    /** sha256-16(.claude/settings.json + .claude/omc.jsonc) */
    omc_config_hash: string;
    /** anonymous UUID, .omc/telemetry/.install-id */
    install_id: string;
    /** sha256-16(agents/<canonical>.md); on agent-handoff + verdict */
    agent_prompt_hash?: string;
    /** sha256-16(skills/<slug>/SKILL.md); on skill-events */
    skill_content_hash?: string;
    /** sha256-16(src/hooks/<name>/index.ts); on hook-events */
    hook_version_hash?: string;
}
export interface AgentHandoffPayload {
    event: 'start' | 'end';
    agent_type: string;
    parent_agent_id?: string;
    model?: string;
    [key: string]: unknown;
}
export interface VerdictPayload {
    event: 'verdict';
    agent_type: string;
    verdict: string;
    duration_ms?: number;
    tokens_in?: number;
    tokens_out?: number;
    reason?: string;
    [key: string]: unknown;
}
export interface SkillEventPayload {
    event: 'detected' | 'invoked' | 'completed';
    skill_slug: string;
    keyword?: string;
    latency_ms?: number;
    outcome?: string;
    [key: string]: unknown;
}
export interface HookEventPayload {
    hook_name: string;
    event: string;
    [key: string]: unknown;
}
export interface LlmInteractionPayload {
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    cache_read?: number;
    cache_write?: number;
    latency_ms?: number;
    [key: string]: unknown;
}
export interface ProductCycleEventPayload {
    event: string;
    cycle_id?: string;
    cycle_stage?: string;
    cycle_goal?: string;
    [key: string]: unknown;
}
export type StreamPayload = AgentHandoffPayload | VerdictPayload | SkillEventPayload | HookEventPayload | LlmInteractionPayload | ProductCycleEventPayload;
export type AgentHandoffEnvelope = BaseEnvelope & AgentHandoffPayload & {
    stream: 'agent-handoff';
};
export type VerdictEnvelope = BaseEnvelope & VerdictPayload & {
    stream: 'verdict';
};
export type SkillEventEnvelope = BaseEnvelope & SkillEventPayload & {
    stream: 'skill-events';
};
export type HookEventEnvelope = BaseEnvelope & HookEventPayload & {
    stream: 'hook-events';
};
export type LlmInteractionEnvelope = BaseEnvelope & LlmInteractionPayload & {
    stream: 'llm-interaction';
};
export type ProductCycleEventEnvelope = BaseEnvelope & ProductCycleEventPayload & {
    stream: 'product-cycle-events';
};
export type TelemetryEnvelope = AgentHandoffEnvelope | VerdictEnvelope | SkillEventEnvelope | HookEventEnvelope | LlmInteractionEnvelope | ProductCycleEventEnvelope;
/**
 * agent-handoff stream schema.
 * strict() rejects unknown fields per plan Section 6.
 */
export declare const agentHandoffSchema: z.ZodObject<{
    event: z.ZodEnum<["start", "end"]>;
    agent_type: z.ZodString;
    parent_agent_id: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    event: "end" | "start";
    agent_type: string;
    model?: string | undefined;
    parent_agent_id?: string | undefined;
}, {
    event: "end" | "start";
    agent_type: string;
    model?: string | undefined;
    parent_agent_id?: string | undefined;
}>;
/**
 * verdict stream schema.
 */
export declare const verdictSchema: z.ZodObject<{
    event: z.ZodLiteral<"verdict">;
    agent_type: z.ZodString;
    verdict: z.ZodString;
    duration_ms: z.ZodOptional<z.ZodNumber>;
    tokens_in: z.ZodOptional<z.ZodNumber>;
    tokens_out: z.ZodOptional<z.ZodNumber>;
    reason: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    verdict: string;
    event: "verdict";
    agent_type: string;
    reason?: string | undefined;
    duration_ms?: number | undefined;
    tokens_in?: number | undefined;
    tokens_out?: number | undefined;
}, {
    verdict: string;
    event: "verdict";
    agent_type: string;
    reason?: string | undefined;
    duration_ms?: number | undefined;
    tokens_in?: number | undefined;
    tokens_out?: number | undefined;
}>;
/**
 * skill-events stream schema.
 */
export declare const skillEventsSchema: z.ZodObject<{
    event: z.ZodEnum<["detected", "invoked", "completed"]>;
    skill_slug: z.ZodString;
    keyword: z.ZodOptional<z.ZodString>;
    latency_ms: z.ZodOptional<z.ZodNumber>;
    outcome: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    event: "completed" | "detected" | "invoked";
    skill_slug: string;
    keyword?: string | undefined;
    latency_ms?: number | undefined;
    outcome?: string | undefined;
}, {
    event: "completed" | "detected" | "invoked";
    skill_slug: string;
    keyword?: string | undefined;
    latency_ms?: number | undefined;
    outcome?: string | undefined;
}>;
/**
 * hook-events stream schema.
 * Allows extra fields via passthrough (hooks attach varying detail fields).
 * NOTE: passthrough() rather than strict() here because hook-events payloads
 * carry arbitrary hook-specific detail fields that cannot be enumerated ahead
 * of time (plan Section 5.3: "...details"). Other streams are strict.
 */
export declare const hookEventsSchema: z.ZodObject<{
    hook_name: z.ZodString;
    event: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    hook_name: z.ZodString;
    event: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    hook_name: z.ZodString;
    event: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
/**
 * llm-interaction stream schema (Phase 2 placeholder — strict but minimal).
 */
export declare const llmInteractionSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    tokens_in: z.ZodNumber;
    tokens_out: z.ZodNumber;
    cache_read: z.ZodOptional<z.ZodNumber>;
    cache_write: z.ZodOptional<z.ZodNumber>;
    latency_ms: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    model: string;
    provider: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms?: number | undefined;
    cache_read?: number | undefined;
    cache_write?: number | undefined;
}, {
    model: string;
    provider: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms?: number | undefined;
    cache_read?: number | undefined;
    cache_write?: number | undefined;
}>;
/**
 * product-cycle-events stream.
 * Allows extra fields because each lifecycle event carries event-specific
 * routing, scorecard, handoff, team, or verification details.
 */
export declare const productCycleEventsSchema: z.ZodObject<{
    event: z.ZodString;
    cycle_id: z.ZodOptional<z.ZodString>;
    cycle_stage: z.ZodOptional<z.ZodString>;
    cycle_goal: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    event: z.ZodString;
    cycle_id: z.ZodOptional<z.ZodString>;
    cycle_stage: z.ZodOptional<z.ZodString>;
    cycle_goal: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    event: z.ZodString;
    cycle_id: z.ZodOptional<z.ZodString>;
    cycle_stage: z.ZodOptional<z.ZodString>;
    cycle_goal: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
/**
 * Validate a payload against the Zod schema for the given stream.
 * Returns { success: true } or { success: false, error: string }.
 * Strict mode: unknown fields are rejected for all streams except hook-events
 * (which uses passthrough to accommodate arbitrary hook detail fields).
 */
export declare function validate(stream: StreamName, payload: Record<string, unknown>): {
    success: true;
} | {
    success: false;
    error: string;
};
/**
 * Legacy compatibility shim — kept so existing callers that import
 * validatePayload continue to work without modification.
 * Returns error string or null if valid.
 * @deprecated Use validate() instead.
 */
export declare function validatePayload(stream: StreamName, payload: Record<string, unknown>): string | null;
//# sourceMappingURL=schemas.d.ts.map
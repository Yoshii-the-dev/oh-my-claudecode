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
// ---------------------------------------------------------------------------
// Zod schemas — one per stream, strict mode (rejects unknown fields)
// ---------------------------------------------------------------------------
/**
 * agent-handoff stream schema.
 * strict() rejects unknown fields per plan Section 6.
 */
export const agentHandoffSchema = z.object({
    event: z.enum(['start', 'end']),
    agent_type: z.string(),
    parent_agent_id: z.string().optional(),
    model: z.string().optional(),
}).strict();
/**
 * verdict stream schema.
 */
export const verdictSchema = z.object({
    event: z.literal('verdict'),
    agent_type: z.string(),
    verdict: z.string(),
    duration_ms: z.number().optional(),
    tokens_in: z.number().optional(),
    tokens_out: z.number().optional(),
    reason: z.string().optional(),
}).strict();
/**
 * skill-events stream schema.
 */
export const skillEventsSchema = z.object({
    event: z.enum(['detected', 'invoked', 'completed']),
    skill_slug: z.string(),
    keyword: z.string().optional(),
    latency_ms: z.number().optional(),
    outcome: z.string().optional(),
}).strict();
/**
 * hook-events stream schema.
 * Allows extra fields via passthrough (hooks attach varying detail fields).
 * NOTE: passthrough() rather than strict() here because hook-events payloads
 * carry arbitrary hook-specific detail fields that cannot be enumerated ahead
 * of time (plan Section 5.3: "...details"). Other streams are strict.
 */
export const hookEventsSchema = z.object({
    hook_name: z.string(),
    event: z.string(),
}).passthrough();
/**
 * llm-interaction stream schema (Phase 2 placeholder — strict but minimal).
 */
export const llmInteractionSchema = z.object({
    provider: z.string(),
    model: z.string(),
    tokens_in: z.number(),
    tokens_out: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    latency_ms: z.number().optional(),
}).strict();
/**
 * product-cycle-events stream.
 * Allows extra fields because each lifecycle event carries event-specific
 * routing, scorecard, handoff, team, or verification details.
 */
export const productCycleEventsSchema = z.object({
    event: z.string(),
    cycle_id: z.string().optional(),
    cycle_stage: z.string().optional(),
    cycle_goal: z.string().optional(),
}).passthrough();
// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------
const SCHEMA_MAP = {
    'agent-handoff': agentHandoffSchema,
    'verdict': verdictSchema,
    'skill-events': skillEventsSchema,
    'hook-events': hookEventsSchema,
    'llm-interaction': llmInteractionSchema,
    'product-cycle-events': productCycleEventsSchema,
};
/**
 * Validate a payload against the Zod schema for the given stream.
 * Returns { success: true } or { success: false, error: string }.
 * Strict mode: unknown fields are rejected for all streams except hook-events
 * (which uses passthrough to accommodate arbitrary hook detail fields).
 */
export function validate(stream, payload) {
    const schema = SCHEMA_MAP[stream];
    if (!schema) {
        return { success: false, error: `unknown stream: ${stream}` };
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
        return { success: false, error: result.error.message };
    }
    return { success: true };
}
/**
 * Legacy compatibility shim — kept so existing callers that import
 * validatePayload continue to work without modification.
 * Returns error string or null if valid.
 * @deprecated Use validate() instead.
 */
export function validatePayload(stream, payload) {
    if (!payload || typeof payload !== 'object') {
        return 'payload must be an object';
    }
    const result = validate(stream, payload);
    if (!result.success) {
        return result.error;
    }
    return null;
}
//# sourceMappingURL=schemas.js.map
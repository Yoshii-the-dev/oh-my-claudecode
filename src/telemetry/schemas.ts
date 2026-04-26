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

export type StreamName =
  | 'agent-handoff'
  | 'verdict'
  | 'skill-events'
  | 'hook-events'
  | 'llm-interaction';

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

  // Version attribution — MANDATORY (Phase 1, Section 11)
  /** package.json `version` field */
  plugin_version: string;
  /** sha256-16(.claude/settings.json + .claude/omc.jsonc) */
  omc_config_hash: string;
  /** anonymous UUID, .omc/telemetry/.install-id */
  install_id: string;

  // Context-specific — auto-attached by writer
  /** sha256-16(agents/<canonical>.md); on agent-handoff + verdict */
  agent_prompt_hash?: string;
  /** sha256-16(skills/<slug>/SKILL.md); on skill-events */
  skill_content_hash?: string;
  /** sha256-16(src/hooks/<name>/index.ts); on hook-events */
  hook_version_hash?: string;
}

// ---------------------------------------------------------------------------
// Stream-specific payload shapes (TypeScript interfaces — kept for consumers)
// ---------------------------------------------------------------------------

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

export type StreamPayload =
  | AgentHandoffPayload
  | VerdictPayload
  | SkillEventPayload
  | HookEventPayload
  | LlmInteractionPayload;

// Full envelope types for each stream
export type AgentHandoffEnvelope = BaseEnvelope & AgentHandoffPayload & { stream: 'agent-handoff' };
export type VerdictEnvelope = BaseEnvelope & VerdictPayload & { stream: 'verdict' };
export type SkillEventEnvelope = BaseEnvelope & SkillEventPayload & { stream: 'skill-events' };
export type HookEventEnvelope = BaseEnvelope & HookEventPayload & { stream: 'hook-events' };
export type LlmInteractionEnvelope = BaseEnvelope & LlmInteractionPayload & { stream: 'llm-interaction' };

export type TelemetryEnvelope =
  | AgentHandoffEnvelope
  | VerdictEnvelope
  | SkillEventEnvelope
  | HookEventEnvelope
  | LlmInteractionEnvelope;

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

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

const SCHEMA_MAP: Record<StreamName, z.ZodTypeAny> = {
  'agent-handoff': agentHandoffSchema,
  'verdict': verdictSchema,
  'skill-events': skillEventsSchema,
  'hook-events': hookEventsSchema,
  'llm-interaction': llmInteractionSchema,
};

/**
 * Validate a payload against the Zod schema for the given stream.
 * Returns { success: true } or { success: false, error: string }.
 * Strict mode: unknown fields are rejected for all streams except hook-events
 * (which uses passthrough to accommodate arbitrary hook detail fields).
 */
export function validate(
  stream: StreamName,
  payload: Record<string, unknown>,
): { success: true } | { success: false; error: string } {
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
export function validatePayload(stream: StreamName, payload: Record<string, unknown>): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'payload must be an object';
  }
  const result = validate(stream, payload);
  if (!result.success) {
    return result.error;
  }
  return null;
}

/**
 * High-level telemetry emit helpers
 *
 * Each helper auto-populates base attribution + the appropriate context-specific
 * hash via version-attribution.ts. Callers MUST NOT pass attribution fields.
 */

import { emit, flush as writerFlush } from './writer.js';

export interface EmitBaseContext {
  /** Project root directory */
  directory: string;
  session_id?: string;
  run_id?: string;
  agent_id?: string;
}

// ---------------------------------------------------------------------------
// emitToolCall — maps to 'hook-events' stream (tool invocations)
// ---------------------------------------------------------------------------

export interface EmitToolCallOptions extends EmitBaseContext {
  hook_name: string;
  tool_name: string;
  /** 'allowed' | 'denied' | 'invoked' | 'completed' */
  event: string;
  latency_ms?: number;
  success?: boolean;
  [key: string]: unknown;
}

export async function emitToolCall(options: EmitToolCallOptions): Promise<void> {
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

// ---------------------------------------------------------------------------
// emitAgentHandoff — maps to 'agent-handoff' stream
// ---------------------------------------------------------------------------

export interface EmitAgentHandoffOptions extends EmitBaseContext {
  kind: 'start' | 'end';
  agent_type: string;
  parent_agent_id?: string;
  model?: string;
  [key: string]: unknown;
}

export async function emitAgentHandoff(options: EmitAgentHandoffOptions): Promise<void> {
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

// ---------------------------------------------------------------------------
// emitLlmInteraction — maps to 'llm-interaction' stream
// ---------------------------------------------------------------------------

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

export async function emitLlmInteraction(options: EmitLlmInteractionOptions): Promise<void> {
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

// ---------------------------------------------------------------------------
// emitHookEvent — maps to 'hook-events' stream
// ---------------------------------------------------------------------------

export interface EmitHookEventOptions extends EmitBaseContext {
  hook_name: string;
  event: string;
  [key: string]: unknown;
}

export async function emitHookEvent(options: EmitHookEventOptions): Promise<void> {
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

// ---------------------------------------------------------------------------
// emitVerdict — maps to 'verdict' stream
// ---------------------------------------------------------------------------

export interface EmitVerdictOptions extends EmitBaseContext {
  agent_type: string;
  verdict: string;
  duration_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  reason?: string;
  [key: string]: unknown;
}

export async function emitVerdict(options: EmitVerdictOptions): Promise<void> {
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

// ---------------------------------------------------------------------------
// emitUserCorrection — maps to 'hook-events' stream (user correction patterns)
// ---------------------------------------------------------------------------

export interface EmitUserCorrectionOptions extends EmitBaseContext {
  matched_pattern: string;
  prompt_hash: string;
  [key: string]: unknown;
}

export async function emitUserCorrection(options: EmitUserCorrectionOptions): Promise<void> {
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

/**
 * Telemetry Writer
 *
 * Append-only JSONL writer with:
 * - Kill-switch via OMC_TELEMETRY_DISABLE=1
 * - File rotation at maxFileBytes (default 8 MB)
 * - Missing-dir auto-create
 * - Error swallow — never throws, failures go to stderr
 * - In-process buffer with flush() for SessionEnd
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamName } from './schemas.js';
import { validatePayload } from './schemas.js';
import { getBaseAttribution, getAgentPromptHash, getSkillContentHash, getHookVersionHash } from './version-attribution.js';
import { rotateIfNeeded as rotateStream } from './rotator.js';

// Re-export StreamName for convenience
export type { StreamName };

export interface EmitOptions {
  /** Project root directory. Used to locate .omc/telemetry/ and version-attribution. */
  directory: string;
  /** Stream slug — picks the target JSONL file. */
  stream: StreamName;
  /** Stream-specific payload. Must NOT include attribution fields. */
  payload: Record<string, unknown>;
}

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

// In-process write buffer for pending envelopes
const pendingBuffer: Array<{ filePath: string; line: string }> = [];

// ---------------------------------------------------------------------------
// Kill-switch
// ---------------------------------------------------------------------------

function isTelemetryDisabled(): boolean {
  return process.env['OMC_TELEMETRY_DISABLE'] === '1';
}

// ---------------------------------------------------------------------------
// Attribution attachment
// ---------------------------------------------------------------------------

function attachContextHash(
  directory: string,
  stream: StreamName,
  payload: Record<string, unknown>,
  attribution: { plugin_version: string; omc_config_hash: string; install_id: string },
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};

  if (stream === 'agent-handoff' || stream === 'verdict') {
    const agentType = (payload['agent_type'] as string | undefined) ?? '';
    const hash = getAgentPromptHash(directory, agentType);
    if (hash) extra['agent_prompt_hash'] = hash;
  } else if (stream === 'skill-events') {
    const slug = (payload['skill_slug'] as string | undefined) ?? '';
    const hash = getSkillContentHash(directory, slug);
    if (hash) extra['skill_content_hash'] = hash;
  } else if (stream === 'hook-events') {
    const hookName = (payload['hook_name'] as string | undefined) ?? '';
    const hash = getHookVersionHash(directory, hookName);
    if (hash) extra['hook_version_hash'] = hash;
  }

  return { ...attribution, ...extra };
}

// ---------------------------------------------------------------------------
// Core append
// ---------------------------------------------------------------------------

function appendToFile(filePath: string, line: string, _maxFileBytes: number): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  appendFileSync(filePath, line + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget structured telemetry emit.
 * Auto-populates base attribution + context-specific hash.
 * Callers must NOT pass attribution fields.
 * Never throws.
 */
export async function emit(options: EmitOptions, maxFileBytes = DEFAULT_MAX_FILE_BYTES): Promise<void> {
  if (isTelemetryDisabled()) return;

  const { directory, stream, payload } = options;

  try {
    // Lift envelope-level fields out of the payload before strict Zod validation.
    // Helpers (emit.ts) pass session_id/run_id/agent_id inside the payload object
    // because that is the public contract — they do not know about envelope internals.
    // These are BaseEnvelope fields, NOT stream-payload fields; strict schemas correctly
    // reject them if left in the payload.  We extract them here and place them at the
    // top level of the envelope after validation.
    const rawPayload = payload as Record<string, unknown>;
    const { session_id, run_id, agent_id, ...streamPayload } = rawPayload;
    const envelopeContext: Record<string, unknown> = {};
    if (session_id !== undefined) envelopeContext['session_id'] = session_id;
    if (run_id !== undefined) envelopeContext['run_id'] = run_id;
    if (agent_id !== undefined) envelopeContext['agent_id'] = agent_id;

    // Validate stream-specific payload shape (without envelope fields)
    const validationError = validatePayload(stream, streamPayload);
    if (validationError) {
      process.stderr.write(`[telemetry] payload validation failed for stream=${stream}: ${validationError}\n`);
      return;
    }

    // Build attribution
    const attribution = getBaseAttribution(directory);
    const contextHash = attachContextHash(directory, stream, streamPayload, attribution);

    // Compose envelope — attribution + envelope context (session/run/agent) + stream payload
    const envelope: Record<string, unknown> = {
      schema_version: 1,
      stream,
      ts: new Date().toISOString(),
      ...contextHash,
      ...envelopeContext,
      ...streamPayload,
    };

    const line = JSON.stringify(envelope);
    const eventsDir = join(directory, '.omc', 'telemetry', 'events');
    const filePath = join(eventsDir, `${stream}.jsonl`);

    // Rotate before appending (delegated to rotator.ts)
    await rotateStream(directory, stream);

    // Write
    try {
      appendToFile(filePath, line, maxFileBytes);
    } catch (writeErr) {
      // Buffer for flush retry
      pendingBuffer.push({ filePath, line });
      process.stderr.write(`[telemetry] write failed, buffered: ${(writeErr as Error).message}\n`);
    }
  } catch (err) {
    // Swallow all errors — telemetry must never break calling hooks
    process.stderr.write(`[telemetry] emit error: ${(err as Error).message}\n`);
  }
}

/**
 * Flush any in-process buffer and release pending writes.
 * Called by SessionEnd hook before aggregator runs.
 */
export async function flush(_directory?: string): Promise<void> {
  if (pendingBuffer.length === 0) return;

  const toFlush = pendingBuffer.splice(0, pendingBuffer.length);
  for (const { filePath, line } of toFlush) {
    try {
      appendToFile(filePath, line, DEFAULT_MAX_FILE_BYTES);
    } catch (err) {
      process.stderr.write(`[telemetry] flush error: ${(err as Error).message}\n`);
    }
  }
}

/**
 * Get the current buffer size (for testing).
 * @internal
 */
export function getPendingBufferSize(): number {
  return pendingBuffer.length;
}

/**
 * Clear the pending buffer (for testing).
 * @internal
 */
export function clearPendingBuffer(): void {
  pendingBuffer.length = 0;
}

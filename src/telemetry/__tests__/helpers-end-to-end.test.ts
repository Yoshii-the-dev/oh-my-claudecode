/**
 * helpers-end-to-end.test.ts
 *
 * Regression test for the strict-schema vs helper-payload mismatch fix.
 *
 * Each high-level helper (emitAgentHandoff, emitVerdict, emitToolCall,
 * emitHookEvent, emitUserCorrection, emitLlmInteraction) passes
 * session_id / run_id / agent_id inside the payload object.  Before the fix
 * those envelope-level fields leaked into the strict Zod validation and caused
 * a silent drop with a stderr warning.  This test catches that regression.
 *
 * For each helper we:
 *  1. Set up a tmp directory with the version-attribution prerequisites.
 *  2. Capture stderr to assert NO "payload validation failed" warning.
 *  3. Call the helper with realistic args including session_id / agent_id.
 *  4. Read back the JSONL file and assert:
 *     - at least one line was written
 *     - the line parses as valid JSON
 *     - session_id / agent_id appear at the ENVELOPE top level
 *     - they do NOT appear inside a nested "payload" sub-object
 *     - attribution fields (plugin_version, omc_config_hash, install_id) are present
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  emitAgentHandoff,
  emitVerdict,
  emitToolCall,
  emitHookEvent,
  emitUserCorrection,
  emitLlmInteraction,
} from '../emit.js';
import { resetAttributionCaches } from '../version-attribution.js';
import { resetSaltCache } from '../redact.js';
import { clearPendingBuffer } from '../writer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestDir(): string {
  const dir = join(tmpdir(), `telemetry-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.omc', 'telemetry'), { recursive: true });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
  return dir;
}

function readJsonlLines(dir: string, stream: string): Record<string, unknown>[] {
  const filePath = join(dir, '.omc', 'telemetry', 'events', `${stream}.jsonl`);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Capture stderr output during an async operation. */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
  }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('telemetry/helpers-end-to-end', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
    resetAttributionCaches();
    resetSaltCache();
    clearPendingBuffer();
    delete process.env['OMC_TELEMETRY_DISABLE'];
  });

  afterEach(() => {
    delete process.env['OMC_TELEMETRY_DISABLE'];
    clearPendingBuffer();
    resetAttributionCaches();
    resetSaltCache();
    rmSync(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // emitAgentHandoff
  // -------------------------------------------------------------------------

  it('emitAgentHandoff: writes envelope with session_id/agent_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitAgentHandoff({
        directory: testDir,
        session_id: 'sess-001',
        run_id: 'run-001',
        agent_id: 'agent-001',
        kind: 'start',
        agent_type: 'executor',
        model: 'claude-sonnet-4-6',
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'agent-handoff');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(typeof env['ts']).toBe('string');
    expect(env['session_id']).toBe('sess-001');
    expect(env['run_id']).toBe('run-001');
    expect(env['agent_id']).toBe('agent-001');
    // Must NOT be nested under a payload sub-key
    expect(env['payload']).toBeUndefined();
    // Attribution fields
    expect(typeof env['plugin_version']).toBe('string');
    expect(typeof env['omc_config_hash']).toBe('string');
    expect(typeof env['install_id']).toBe('string');
    // Stream payload fields
    expect(env['event']).toBe('start');
    expect(env['agent_type']).toBe('executor');
  });

  // -------------------------------------------------------------------------
  // emitVerdict
  // -------------------------------------------------------------------------

  it('emitVerdict: writes envelope with session_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitVerdict({
        directory: testDir,
        session_id: 'sess-002',
        agent_id: 'agent-002',
        agent_type: 'verifier',
        verdict: 'pass',
        duration_ms: 1234,
        tokens_in: 500,
        tokens_out: 200,
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'verdict');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(env['session_id']).toBe('sess-002');
    expect(env['agent_id']).toBe('agent-002');
    expect(env['payload']).toBeUndefined();
    expect(typeof env['plugin_version']).toBe('string');
    expect(env['verdict']).toBe('pass');
  });

  // -------------------------------------------------------------------------
  // emitToolCall
  // -------------------------------------------------------------------------

  it('emitToolCall: writes envelope with session_id/agent_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitToolCall({
        directory: testDir,
        session_id: 'sess-003',
        agent_id: 'agent-003',
        hook_name: 'permission-handler',
        tool_name: 'Bash',
        event: 'allowed',
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'hook-events');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(env['session_id']).toBe('sess-003');
    expect(env['agent_id']).toBe('agent-003');
    expect(env['payload']).toBeUndefined();
    expect(typeof env['plugin_version']).toBe('string');
    expect(env['event']).toBe('allowed');
  });

  // -------------------------------------------------------------------------
  // emitHookEvent
  // -------------------------------------------------------------------------

  it('emitHookEvent: writes envelope with session_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitHookEvent({
        directory: testDir,
        session_id: 'sess-004',
        run_id: 'run-004',
        hook_name: 'mode-registry',
        event: 'mode_detected',
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'hook-events');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(env['session_id']).toBe('sess-004');
    expect(env['run_id']).toBe('run-004');
    expect(env['payload']).toBeUndefined();
    expect(typeof env['plugin_version']).toBe('string');
  });

  // -------------------------------------------------------------------------
  // emitUserCorrection
  // -------------------------------------------------------------------------

  it('emitUserCorrection: writes envelope with session_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitUserCorrection({
        directory: testDir,
        session_id: 'sess-005',
        matched_pattern: 'no-direct-impl',
        prompt_hash: 'abcd1234',
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'hook-events');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(env['session_id']).toBe('sess-005');
    expect(env['payload']).toBeUndefined();
    expect(typeof env['plugin_version']).toBe('string');
    expect(env['matched_pattern']).toBe('no-direct-impl');
  });

  // -------------------------------------------------------------------------
  // emitLlmInteraction
  // -------------------------------------------------------------------------

  it('emitLlmInteraction: writes envelope with session_id/agent_id at top level, no validation warning', async () => {
    let stderr = '';
    stderr = await captureStderr(async () => {
      await emitLlmInteraction({
        directory: testDir,
        session_id: 'sess-006',
        agent_id: 'agent-006',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        tokens_in: 1000,
        tokens_out: 500,
        cache_read: 200,
        latency_ms: 800,
      });
    });

    expect(stderr).not.toContain('payload validation failed');

    const lines = readJsonlLines(testDir, 'llm-interaction');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const env = lines[lines.length - 1];
    expect(env['session_id']).toBe('sess-006');
    expect(env['agent_id']).toBe('agent-006');
    expect(env['payload']).toBeUndefined();
    expect(typeof env['plugin_version']).toBe('string');
    expect(typeof env['omc_config_hash']).toBe('string');
    expect(typeof env['install_id']).toBe('string');
    expect(env['provider']).toBe('anthropic');
    expect(env['tokens_in']).toBe(1000);
  });
});

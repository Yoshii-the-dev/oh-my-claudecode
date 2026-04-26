/**
 * M8: Multi-stream attribution test
 *
 * Verifies that every telemetry stream emitted via emit() carries the three
 * mandatory version attribution fields:
 *   - plugin_version
 *   - omc_config_hash
 *   - install_id
 *
 * Acceptance criteria (plan Section 8, criterion 8):
 * - All 5 streams have attribution fields in the emitted JSONL lines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emit } from '../writer.js';
import { resetAttributionCaches } from '../version-attribution.js';

const ALL_STREAMS = [
  'agent-handoff',
  'verdict',
  'skill-events',
  'hook-events',
  'llm-interaction',
] as const;

/** Valid minimal payloads for each stream */
const STREAM_PAYLOADS: Record<typeof ALL_STREAMS[number], Record<string, unknown>> = {
  'agent-handoff': { event: 'start', agent_type: 'executor' },
  'verdict': { event: 'verdict', agent_type: 'executor', verdict: 'propose' },
  'skill-events': { event: 'invoked', skill_slug: 'ralph' },
  'hook-events': { hook_name: 'learner', event: 'fired' },
  'llm-interaction': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    tokens_in: 100,
    tokens_out: 50,
  },
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `attribution-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  // Reset caches so each test gets a fresh install_id derived from tmpDir
  resetAttributionCaches();
  // Ensure telemetry is enabled
  delete process.env['OMC_TELEMETRY_DISABLE'];
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  resetAttributionCaches();
});

describe('M8: multi-stream attribution', () => {
  it('stamps plugin_version, omc_config_hash, and install_id on all 5 streams', async () => {
    // Emit one event per stream
    await Promise.all(
      ALL_STREAMS.map((stream) =>
        emit({
          directory: tmpDir,
          stream,
          payload: STREAM_PAYLOADS[stream],
        }),
      ),
    );

    // Read back each JSONL file and verify attribution fields
    for (const stream of ALL_STREAMS) {
      const filePath = join(tmpDir, '.omc', 'telemetry', 'events', `${stream}.jsonl`);
      let fileContent: string;
      try {
        fileContent = readFileSync(filePath, 'utf-8');
      } catch {
        throw new Error(`Expected JSONL file for stream "${stream}" at ${filePath} but it was not created`);
      }

      const lines = fileContent.trim().split('\n').filter(Boolean);
      expect(lines.length, `stream="${stream}" should have exactly 1 event`).toBe(1);

      const envelope = JSON.parse(lines[0]) as Record<string, unknown>;

      // Verify schema_version
      expect(envelope['schema_version'], `stream="${stream}": schema_version`).toBe(1);

      // Verify stream field
      expect(envelope['stream'], `stream="${stream}": stream field`).toBe(stream);

      // Verify the 3 mandatory attribution fields are present and non-empty strings
      expect(
        typeof envelope['plugin_version'],
        `stream="${stream}": plugin_version should be a string`,
      ).toBe('string');
      expect(
        (envelope['plugin_version'] as string).length,
        `stream="${stream}": plugin_version should be non-empty`,
      ).toBeGreaterThan(0);

      expect(
        typeof envelope['omc_config_hash'],
        `stream="${stream}": omc_config_hash should be a string`,
      ).toBe('string');
      expect(
        (envelope['omc_config_hash'] as string).length,
        `stream="${stream}": omc_config_hash should be non-empty`,
      ).toBeGreaterThan(0);

      expect(
        typeof envelope['install_id'],
        `stream="${stream}": install_id should be a string`,
      ).toBe('string');
      expect(
        (envelope['install_id'] as string).length,
        `stream="${stream}": install_id should be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('uses the same install_id across all streams within a single process', async () => {
    // Emit to all streams
    await Promise.all(
      ALL_STREAMS.map((stream) =>
        emit({
          directory: tmpDir,
          stream,
          payload: STREAM_PAYLOADS[stream],
        }),
      ),
    );

    const installIds = new Set<string>();
    const configHashes = new Set<string>();
    const pluginVersions = new Set<string>();

    for (const stream of ALL_STREAMS) {
      const filePath = join(tmpDir, '.omc', 'telemetry', 'events', `${stream}.jsonl`);
      const content = readFileSync(filePath, 'utf-8');
      const envelope = JSON.parse(content.trim()) as Record<string, unknown>;

      installIds.add(envelope['install_id'] as string);
      configHashes.add(envelope['omc_config_hash'] as string);
      pluginVersions.add(envelope['plugin_version'] as string);
    }

    // All streams should share the same attribution values within a single run
    expect(installIds.size, 'install_id should be consistent across all streams').toBe(1);
    expect(configHashes.size, 'omc_config_hash should be consistent across all streams').toBe(1);
    expect(pluginVersions.size, 'plugin_version should be consistent across all streams').toBe(1);
  });

  it('persists install_id between separate emit calls', async () => {
    // First emit
    await emit({
      directory: tmpDir,
      stream: 'hook-events',
      payload: { hook_name: 'learner', event: 'fired' },
    });

    // Second emit (same process, same dir — should reuse cached install_id)
    await emit({
      directory: tmpDir,
      stream: 'hook-events',
      payload: { hook_name: 'rules-injector', event: 'fired' },
    });

    const filePath = join(tmpDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    const second = JSON.parse(lines[1]) as Record<string, unknown>;

    expect(first['install_id']).toBe(second['install_id']);
    expect(first['plugin_version']).toBe(second['plugin_version']);
  });
});

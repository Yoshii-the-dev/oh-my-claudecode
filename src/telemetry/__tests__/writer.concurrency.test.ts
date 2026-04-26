/**
 * writer.concurrency.test.ts
 *
 * Proves no torn writes / no corruption under concurrent load.
 *
 * Spawns 4 concurrent writers via Promise.all — each calls emit() 250 times
 * against the SAME tmp directory and SAME stream file.
 * Total: 1000 emits to one file.
 *
 * After flush: reads the JSONL file, asserts exactly 1000 lines, each line
 * parses as JSON, each has plugin_version, omc_config_hash, install_id.
 *
 * NOTE: appendFileSync is safe for concurrent writes up to PIPE_BUF (typically
 * 4 KB on Linux/macOS) because the OS guarantees atomic writes at that size.
 * Our envelopes are well under 4 KB, so this test should pass with the current
 * synchronous writer.  If it fails under stress, that indicates a real
 * production risk and must be fixed in the writer, not worked around here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emit, flush, clearPendingBuffer } from '../writer.js';
import { resetAttributionCaches } from '../version-attribution.js';
import { resetSaltCache } from '../redact.js';

describe('telemetry/writer concurrency', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `telemetry-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
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

  it('4 concurrent writers × 250 emits = exactly 1000 valid JSONL lines', async () => {
    const WORKERS = 4;
    const EMITS_PER_WORKER = 250;
    const TOTAL = WORKERS * EMITS_PER_WORKER;

    // Run 4 workers in parallel — each worker emits 250 times sequentially
    await Promise.all(
      Array.from({ length: WORKERS }, (_, workerIdx) =>
        (async () => {
          for (let i = 0; i < EMITS_PER_WORKER; i++) {
            await emit({
              directory: testDir,
              stream: 'hook-events',
              payload: {
                hook_name: `worker-${workerIdx}`,
                event: `emit-${i}`,
              },
            });
          }
        })(),
      ),
    );

    // Flush any buffered writes
    await flush(testDir);

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    // Exactly TOTAL lines (4 workers × 250 emits)
    expect(lines.length).toBe(TOTAL);

    // Every line must be valid JSON with required attribution fields
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(typeof parsed['plugin_version']).toBe('string');
      expect(typeof parsed['omc_config_hash']).toBe('string');
      expect(typeof parsed['install_id']).toBe('string');
      expect(parsed['schema_version']).toBe(1);
      expect(parsed['stream']).toBe('hook-events');
    }
  }, 30_000); // 30s timeout for 1000 concurrent file ops
});

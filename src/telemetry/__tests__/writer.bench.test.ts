/**
 * writer.bench.test.ts
 *
 * Performance benchmark: emitToolCall p99 < 10ms over 1000 iterations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitToolCall } from '../emit.js';
import { resetAttributionCaches } from '../version-attribution.js';
import { resetSaltCache } from '../redact.js';
import { clearPendingBuffer } from '../writer.js';

describe('telemetry/writer benchmark', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
    resetAttributionCaches();
    resetSaltCache();
    clearPendingBuffer();
    delete process.env['OMC_TELEMETRY_DISABLE'];
  });

  afterEach(() => {
    clearPendingBuffer();
    resetAttributionCaches();
    resetSaltCache();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('emitToolCall p99 < 10ms over 1000 iterations', async () => {
    const ITERATIONS = 1000;
    const latencies: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      await emitToolCall({
        directory: testDir,
        hook_name: 'permission-handler',
        tool_name: 'Bash',
        event: 'allowed',
      });
      const end = performance.now();
      latencies.push(end - start);
    }

    latencies.sort((a, b) => a - b);
    const p99Index = Math.floor(ITERATIONS * 0.99);
    const p99 = latencies[p99Index];
    const p50 = latencies[Math.floor(ITERATIONS * 0.50)];
    const max = latencies[ITERATIONS - 1];

    console.log(`emitToolCall over ${ITERATIONS} iterations:`);
    console.log(`  p50: ${p50.toFixed(3)}ms`);
    console.log(`  p99: ${p99.toFixed(3)}ms`);
    console.log(`  max: ${max.toFixed(3)}ms`);

    expect(p99).toBeLessThan(10);
  }, 60_000); // Allow up to 60s for 1000 iterations
});

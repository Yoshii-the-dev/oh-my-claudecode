/**
 * writer.test.ts
 *
 * Covers: append, rotation at maxFileBytes, kill-switch via OMC_TELEMETRY_DISABLE=1,
 * missing-dir auto-create, error swallow, envelope attribution fields.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emit, flush, clearPendingBuffer } from '../writer.js';
import { resetAttributionCaches } from '../version-attribution.js';
import { resetSaltCache } from '../redact.js';

describe('telemetry/writer', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Create minimal structure so version-attribution can find package.json
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
    // Reset caches so each test gets a fresh state
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

  it('appends a valid JSONL line to the correct stream file', async () => {
    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'test-hook', event: 'triggered' },
    });

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.stream).toBe('hook-events');
    expect(parsed.schema_version).toBe(1);
    expect(parsed.hook_name).toBe('test-hook');
    expect(parsed.event).toBe('triggered');
    expect(typeof parsed.ts).toBe('string');
  });

  it('auto-creates missing events directory', async () => {
    // No events dir pre-created
    const eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    expect(existsSync(eventsDir)).toBe(false);

    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'auto-dir', event: 'test' },
    });

    expect(existsSync(eventsDir)).toBe(true);
    const filePath = join(eventsDir, 'hook-events.jsonl');
    expect(existsSync(filePath)).toBe(true);
  });

  it('rotates file when 8 MB threshold is exceeded (via rotator)', async () => {
    const eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    mkdirSync(eventsDir, { recursive: true });
    const filePath = join(eventsDir, 'hook-events.jsonl');

    // Pre-seed with 8 MB of data so rotator triggers
    writeFileSync(filePath, Buffer.alloc(8 * 1024 * 1024, 'x'));

    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'rotator', event: 'test' },
    });

    // After rotation, file should have been truncated and new line appended
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.hook_name).toBe('rotator');
  });

  it('respects OMC_TELEMETRY_DISABLE=1 kill-switch — produces no files', async () => {
    process.env['OMC_TELEMETRY_DISABLE'] = '1';

    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'disabled', event: 'test' },
    });

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    expect(existsSync(filePath)).toBe(false);
  });

  it('swallows errors from invalid payloads without throwing', async () => {
    // Pass invalid payload (missing required hook_name for hook-events)
    await expect(
      emit({
        directory: testDir,
        stream: 'hook-events',
        payload: { event: 'missing_hook_name' },
      }),
    ).resolves.toBeUndefined();
  });

  it('every envelope contains plugin_version, omc_config_hash, install_id', async () => {
    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'attribution-check', event: 'test' },
    });

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    const line = readFileSync(filePath, 'utf-8').trim();
    const parsed = JSON.parse(line);

    expect(typeof parsed.plugin_version).toBe('string');
    expect(parsed.plugin_version.length).toBeGreaterThan(0);
    expect(typeof parsed.omc_config_hash).toBe('string');
    expect(parsed.omc_config_hash.length).toBe(16);
    expect(typeof parsed.install_id).toBe('string');
    expect(parsed.install_id.length).toBeGreaterThan(0);
  });

  it('appends multiple lines to the same stream file', async () => {
    for (let i = 0; i < 5; i++) {
      await emit({
        directory: testDir,
        stream: 'hook-events',
        payload: { hook_name: `hook-${i}`, event: 'test' },
      });
    }

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'hook-events.jsonl');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(5);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.schema_version).toBe(1);
    }
  });

  it('writes to different files per stream', async () => {
    await emit({
      directory: testDir,
      stream: 'hook-events',
      payload: { hook_name: 'h', event: 'e' },
    });
    await emit({
      directory: testDir,
      stream: 'agent-handoff',
      payload: { event: 'start', agent_type: 'executor' },
    });
    await emit({
      directory: testDir,
      stream: 'verdict',
      payload: { event: 'verdict', agent_type: 'executor', verdict: 'pass' },
    });

    const eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    expect(existsSync(join(eventsDir, 'hook-events.jsonl'))).toBe(true);
    expect(existsSync(join(eventsDir, 'agent-handoff.jsonl'))).toBe(true);
    expect(existsSync(join(eventsDir, 'verdict.jsonl'))).toBe(true);
  });

  it('flush() completes without error even with empty buffer', async () => {
    await expect(flush()).resolves.toBeUndefined();
  });

  it('attribution fields: plugin_version matches package.json 4.22.0', async () => {
    await emit({
      directory: testDir,
      stream: 'skill-events',
      payload: { event: 'detected', skill_slug: 'test-skill' },
    });

    const filePath = join(testDir, '.omc', 'telemetry', 'events', 'skill-events.jsonl');
    const line = readFileSync(filePath, 'utf-8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.plugin_version).toBe('4.22.0');
  });
});

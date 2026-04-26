/**
 * telemetry.test.ts
 *
 * Integration-style test for `omc telemetry digest` CLI subcommand.
 * Uses telemetryDigestCommand() directly (same code path as CLI) with a
 * tmp project dir containing synthetic JSONL events.
 * Asserts that a digest file is produced at the correct path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { telemetryDigestCommand } from '../telemetry.js';
import { resetAttributionCaches } from '../../../telemetry/version-attribution.js';

function makeEvent(stream: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    stream,
    ts: new Date().toISOString(),
    plugin_version: '4.22.0',
    omc_config_hash: 'abc1234567890123',
    install_id: 'test-install-id-00000000',
    ...overrides,
  });
}

describe('CLI: omc telemetry digest', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cli-telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));

    // Seed synthetic events
    writeFileSync(
      join(eventsDir, 'hook-events.jsonl'),
      [
        makeEvent('hook-events', { hook_name: 'factcheck', event: 'fired' }),
        makeEvent('hook-events', { hook_name: 'keyword-detector', event: 'matched' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(
      join(eventsDir, 'agent-handoff.jsonl'),
      makeEvent('agent-handoff', { event: 'start', agent_type: 'executor' }) + '\n',
      'utf-8',
    );
    writeFileSync(
      join(eventsDir, 'verdict.jsonl'),
      makeEvent('verdict', { event: 'verdict', agent_type: 'executor', verdict: 'propose' }) + '\n',
      'utf-8',
    );

    resetAttributionCaches();
  });

  afterEach(() => {
    resetAttributionCaches();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('produces a digest file at digests/daily/<date>.md', async () => {
    // Suppress console.log during test
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await telemetryDigestCommand({ directory: testDir });

    logSpy.mockRestore();

    const dailyDir = join(testDir, '.omc', 'telemetry', 'digests', 'daily');
    expect(existsSync(dailyDir)).toBe(true);

    const { readdirSync } = await import('node:fs');
    const files = readdirSync(dailyDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('also writes latest.md', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await telemetryDigestCommand({ directory: testDir });

    logSpy.mockRestore();

    const latestPath = join(testDir, '.omc', 'telemetry', 'digests', 'latest.md');
    expect(existsSync(latestPath)).toBe(true);
  });

  it('digest file contains expected sections', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await telemetryDigestCommand({ directory: testDir });

    logSpy.mockRestore();

    const { readFileSync, readdirSync } = await import('node:fs');
    const dailyDir = join(testDir, '.omc', 'telemetry', 'digests', 'daily');
    const files = readdirSync(dailyDir).filter(f => f.endsWith('.md'));
    const content = readFileSync(join(dailyDir, files[0]), 'utf-8');

    expect(content).toMatch(/# OMC Telemetry Digest/);
    expect(content).toMatch(/## Agent Handoffs/);
    expect(content).toMatch(/## Verdicts/);
    expect(content).toMatch(/## Hook Events/);
    expect(content).toMatch(/## Plugin Version Distribution/);
    expect(content).toMatch(/4\.22\.0/);
    expect(content).toMatch(/factcheck/);
    expect(content).toMatch(/executor/);
  });

  it('uses process.cwd() when no directory option provided', async () => {
    // The actual directory doesn't matter — just ensure it resolves without throwing
    // by pointing at a dir that exists (testDir)
    const origCwd = process.cwd;
    process.cwd = () => testDir;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await telemetryDigestCommand({}); // no directory option
    } finally {
      process.cwd = origCwd;
      logSpy.mockRestore();
    }

    const dailyDir = join(testDir, '.omc', 'telemetry', 'digests', 'daily');
    expect(existsSync(dailyDir)).toBe(true);
  });
});

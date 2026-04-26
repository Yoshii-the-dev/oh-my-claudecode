/**
 * session-end-aggregate.test.ts
 *
 * Unit test: verifies that processSessionEnd() calls aggregate({ trigger: 'session-end' })
 * after flushing telemetry, and that aggregate failures are swallowed.
 *
 * Uses vi.mock to intercept the aggregate call and verify arguments.
 * For the integration test (digest file produced), see session-end-aggregate-integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resetAttributionCaches } from '../../../telemetry/version-attribution.js';
import { resetSaltCache } from '../../../telemetry/redact.js';
import { clearPendingBuffer } from '../../../telemetry/writer.js';

// ---------------------------------------------------------------------------
// Mock the aggregator module so we can observe calls
// ---------------------------------------------------------------------------

const aggregateMock = vi.hoisted(() => vi.fn().mockResolvedValue({ digestPath: '/tmp/mock-digest.md' }));

vi.mock('../../../telemetry/aggregator.js', () => ({
  aggregate: aggregateMock,
}));

// Mock all the heavy external deps that processSessionEnd uses
vi.mock('../callbacks.js', () => ({
  triggerStopCallbacks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../features/auto-update.js', () => ({
  getOMCConfig: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../notifications/config.js', () => ({
  buildConfigFromEnv: vi.fn().mockReturnValue(null),
  getEnabledPlatforms: vi.fn().mockReturnValue([]),
  getNotificationConfig: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../notifications/index.js', () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../tools/python-repl/bridge-manager.js', () => ({
  cleanupBridgeSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../team/team-ops.js', () => ({
  teamReadManifest: vi.fn().mockResolvedValue(null),
  teamReadConfig: vi.fn().mockResolvedValue(null),
  teamCleanup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../team/runtime-v2.js', () => ({
  shutdownTeamV2: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../team/runtime.js', () => ({
  shutdownTeam: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../notifications/session-registry.js', () => ({
  removeSession: vi.fn(),
  loadAllMappings: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../notifications/reply-listener.js', () => ({
  stopReplyListener: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeInput(sessionId = 'test-session-agg-123') {
  return {
    session_id: sessionId,
    transcript_path: path.join(tmpDir, 'transcript.jsonl'),
    cwd: tmpDir,
    permission_mode: 'default',
    hook_event_name: 'SessionEnd' as const,
    reason: 'clear' as const,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-session-agg-test-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.omc', 'telemetry', 'events'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
  fs.writeFileSync(path.join(tmpDir, 'transcript.jsonl'), '', 'utf-8');
  resetAttributionCaches();
  resetSaltCache();
  clearPendingBuffer();
  aggregateMock.mockClear();
  delete process.env['OMC_TELEMETRY_DISABLE'];
});

afterEach(() => {
  delete process.env['OMC_TELEMETRY_DISABLE'];
  clearPendingBuffer();
  resetAttributionCaches();
  resetSaltCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-end: aggregate on session end (mocked)', () => {
  it('calls aggregate({ trigger: session-end, sessionId }) during processSessionEnd', async () => {
    const { processSessionEnd } = await import('../index.js');
    const sessionId = 'test-session-agg-123';

    const result = await processSessionEnd(makeInput(sessionId));
    expect(result.continue).toBe(true);

    // aggregate should have been called with trigger='session-end'
    expect(aggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'session-end',
        sessionId,
      }),
    );
  });

  it('aggregate failure is swallowed — session end still returns { continue: true }', async () => {
    aggregateMock.mockRejectedValueOnce(new Error('aggregate exploded'));

    const { processSessionEnd } = await import('../index.js');
    const result = await processSessionEnd(makeInput());

    expect(result.continue).toBe(true);
  });

  it('existing session-end behavior is preserved', async () => {
    const { processSessionEnd } = await import('../index.js');
    const result = await processSessionEnd(makeInput());
    expect(result).toEqual({ continue: true });
  });
});

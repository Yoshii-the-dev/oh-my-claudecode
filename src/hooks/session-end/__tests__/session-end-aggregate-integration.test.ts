/**
 * session-end-aggregate-integration.test.ts
 *
 * Integration test: verifies that aggregate({ trigger: 'session-end' })
 * produces a session digest at .omc/telemetry/digests/session/<sessionId>.md.
 *
 * This uses the real aggregator (no mocks) to verify the file is actually
 * written with the correct content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { aggregate } from '../../../telemetry/aggregator.js';
import { resetAttributionCaches } from '../../../telemetry/version-attribution.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-session-agg-integ-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.omc', 'telemetry', 'events'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
  resetAttributionCaches();
});

afterEach(() => {
  resetAttributionCaches();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('aggregator: session-end produces session digest', () => {
  it('creates digests/session/<sessionId>.md', async () => {
    const sessionId = 'integration-session-456';

    const { digestPath } = await aggregate({
      directory: tmpDir,
      trigger: 'session-end',
      sessionId,
    });

    expect(fs.existsSync(digestPath)).toBe(true);
    expect(digestPath).toMatch(new RegExp(`session/${sessionId}\\.md$`));

    const content = fs.readFileSync(digestPath, 'utf-8');
    expect(content).toMatch(/# OMC Telemetry Digest/);
    expect(content).toMatch(new RegExp(`Session ${sessionId}`));
  });

  it('session digest does NOT write latest.md (only on-demand does)', async () => {
    const sessionId = 'session-no-latest-789';

    await aggregate({
      directory: tmpDir,
      trigger: 'session-end',
      sessionId,
    });

    const latestPath = path.join(tmpDir, '.omc', 'telemetry', 'digests', 'latest.md');
    expect(fs.existsSync(latestPath)).toBe(false);
  });
});

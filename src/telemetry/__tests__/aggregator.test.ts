/**
 * aggregator.test.ts
 *
 * Covers:
 * - on-demand trigger produces digests/daily/<YYYY-MM-DD>.md + latest.md
 * - session-end trigger produces digests/session/<sessionId>.md
 * - digest contains expected metric sections
 * - self-improve panel appears when raw_data.json present
 * - self-improve panel is skipped silently when file absent
 * - plugin_version_distribution appears in digest
 * - top-3 sections appear when data exists
 * - aggregate never throws even on errors
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aggregate } from '../aggregator.js';
import { resetAttributionCaches } from '../version-attribution.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeJsonl(filePath: string, events: Record<string, unknown>[]): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

function makeBaseEnvelope(stream: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    stream,
    ts: new Date().toISOString(),
    plugin_version: '4.22.0',
    omc_config_hash: 'abc1234567890123',
    install_id: 'test-install-id-00000000',
    ...overrides,
  };
}

describe('telemetry/aggregator', () => {
  let testDir: string;
  let eventsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aggregator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
    resetAttributionCaches();
  });

  afterEach(() => {
    resetAttributionCaches();
    rmSync(testDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // on-demand trigger
  // ---------------------------------------------------------------------------

  it('on-demand produces digests/daily/<date>.md', async () => {
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired' }),
    ]);

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });

    expect(existsSync(digestPath)).toBe(true);
    expect(digestPath).toMatch(/digests\/daily\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it('on-demand also writes latest.md', async () => {
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired' }),
    ]);

    await aggregate({ directory: testDir, trigger: 'on-demand' });

    const latestPath = join(testDir, '.omc', 'telemetry', 'digests', 'latest.md');
    expect(existsSync(latestPath)).toBe(true);
  });

  it('on-demand digest contains expected sections', async () => {
    writeJsonl(join(eventsDir, 'agent-handoff.jsonl'), [
      makeBaseEnvelope('agent-handoff', { event: 'start', agent_type: 'executor' }),
      makeBaseEnvelope('agent-handoff', { event: 'end', agent_type: 'executor' }),
    ]);
    writeJsonl(join(eventsDir, 'verdict.jsonl'), [
      makeBaseEnvelope('verdict', { event: 'verdict', agent_type: 'executor', verdict: 'propose', duration_ms: 1200 }),
    ]);
    writeJsonl(join(eventsDir, 'skill-events.jsonl'), [
      makeBaseEnvelope('skill-events', { event: 'detected', skill_slug: 'autopilot', keyword: 'autopilot' }),
      makeBaseEnvelope('skill-events', { event: 'invoked', skill_slug: 'autopilot' }),
    ]);
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired' }),
      makeBaseEnvelope('hook-events', { hook_name: 'keyword-detector', event: 'matched' }),
    ]);

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    // Header
    expect(content).toMatch(/# OMC Telemetry Digest/);
    expect(content).toMatch(/\*\*Window:\*\* Daily/);
    expect(content).toMatch(/\*\*Generated at:\*\*/);

    // Sections
    expect(content).toMatch(/## Agent Handoffs/);
    expect(content).toMatch(/## Verdicts/);
    expect(content).toMatch(/## Skill Events/);
    expect(content).toMatch(/## Hook Events/);
    expect(content).toMatch(/## Plugin Version Distribution/);
    expect(content).toMatch(/## Top Volume/);
    expect(content).toMatch(/## LLM Metrics/);

    // Agent data
    expect(content).toMatch(/executor/);
    expect(content).toMatch(/Total: \*\*2\*\*/);  // 2 handoffs

    // Verdict data
    expect(content).toMatch(/propose/);
    expect(content).toMatch(/Avg duration:/);
    expect(content).toMatch(/1200/);

    // Skill data
    expect(content).toMatch(/autopilot/);
    expect(content).toMatch(/Keyword hit rate:/);

    // Hook data
    expect(content).toMatch(/factcheck/);
    expect(content).toMatch(/keyword-detector/);

    // Plugin version
    expect(content).toMatch(/4\.22\.0/);
  });

  // ---------------------------------------------------------------------------
  // session-end trigger
  // ---------------------------------------------------------------------------

  it('session-end produces digests/session/<sessionId>.md', async () => {
    const sessionId = 'test-session-abc123';
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', session_id: sessionId }),
    ]);

    const { digestPath } = await aggregate({
      directory: testDir,
      trigger: 'session-end',
      sessionId,
    });

    expect(existsSync(digestPath)).toBe(true);
    expect(digestPath).toMatch(new RegExp(`digests/session/${sessionId}\\.md$`));
  });

  it('session-end digest contains session window label', async () => {
    const sessionId = 'my-session-999';
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', session_id: sessionId }),
    ]);

    const { digestPath } = await aggregate({
      directory: testDir,
      trigger: 'session-end',
      sessionId,
    });

    const content = readFileSync(digestPath, 'utf-8');
    expect(content).toMatch(new RegExp(`Session ${sessionId}`));
  });

  it('session-end filters events to session scope', async () => {
    const sessionId = 'session-xyz';
    const otherSessionId = 'session-other';

    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', session_id: sessionId }),
      makeBaseEnvelope('hook-events', { hook_name: 'learner', event: 'fired', session_id: otherSessionId }),
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', session_id: sessionId }),
    ]);

    const { digestPath } = await aggregate({
      directory: testDir,
      trigger: 'session-end',
      sessionId,
    });

    const content = readFileSync(digestPath, 'utf-8');
    // Only 2 factcheck events for this session
    expect(content).toMatch(/Total: \*\*2\*\*/);
  });

  // ---------------------------------------------------------------------------
  // Self-improve panel
  // ---------------------------------------------------------------------------

  it('includes self-improve panel when raw_data.json present', async () => {
    // Create self-improve raw_data.json
    const selfImproveDir = join(testDir, '.omc', 'self-improve', 'tracking');
    mkdirSync(selfImproveDir, { recursive: true });
    writeFileSync(join(selfImproveDir, 'raw_data.json'), JSON.stringify({
      generation: 3,
      leader: 'candidate-b',
      candidates: [
        { candidate_id: 'candidate-a', score: 0.85, wins: 10, losses: 2 },
        { candidate_id: 'candidate-b', score: 0.92, wins: 14, losses: 1 },
      ],
    }));

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    expect(content).toMatch(/## Self-Improve Panel/);
    expect(content).toMatch(/Tournament generation.*3/);
    expect(content).toMatch(/Current leader.*candidate-b/);
    expect(content).toMatch(/candidate-a/);
    expect(content).toMatch(/0\.85/);
    expect(content).toMatch(/candidate-b/);
    expect(content).toMatch(/0\.92/);
  });

  it('skips self-improve panel silently when raw_data.json absent', async () => {
    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    expect(content).not.toMatch(/## Self-Improve Panel/);
  });

  // ---------------------------------------------------------------------------
  // Plugin version distribution
  // ---------------------------------------------------------------------------

  it('plugin_version_distribution shows correct counts', async () => {
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', plugin_version: '4.22.0' }),
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', plugin_version: '4.22.0' }),
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired', plugin_version: '4.21.0' }),
    ]);

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    expect(content).toMatch(/4\.22\.0/);
    expect(content).toMatch(/4\.21\.0/);
  });

  it('marks events without plugin_version as pre-telemetry', async () => {
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      // No plugin_version
      { schema_version: 1, stream: 'hook-events', ts: new Date().toISOString(), hook_name: 'factcheck', event: 'fired' },
    ]);

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    expect(content).toMatch(/pre-telemetry/);
  });

  // ---------------------------------------------------------------------------
  // Top-3 sections
  // ---------------------------------------------------------------------------

  it('top volume section shows top agents, skills, hooks', async () => {
    writeJsonl(join(eventsDir, 'agent-handoff.jsonl'), [
      makeBaseEnvelope('agent-handoff', { event: 'start', agent_type: 'executor' }),
      makeBaseEnvelope('agent-handoff', { event: 'start', agent_type: 'executor' }),
      makeBaseEnvelope('agent-handoff', { event: 'start', agent_type: 'planner' }),
    ]);
    writeJsonl(join(eventsDir, 'skill-events.jsonl'), [
      makeBaseEnvelope('skill-events', { event: 'invoked', skill_slug: 'autopilot' }),
      makeBaseEnvelope('skill-events', { event: 'invoked', skill_slug: 'ralph' }),
    ]);
    writeJsonl(join(eventsDir, 'hook-events.jsonl'), [
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired' }),
      makeBaseEnvelope('hook-events', { hook_name: 'factcheck', event: 'fired' }),
      makeBaseEnvelope('hook-events', { hook_name: 'keyword-detector', event: 'matched' }),
    ]);

    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    const content = readFileSync(digestPath, 'utf-8');

    expect(content).toMatch(/Top agents:/);
    expect(content).toMatch(/executor: 2/);
    expect(content).toMatch(/Top skills:/);
    expect(content).toMatch(/autopilot: 1/);
    expect(content).toMatch(/Top hooks:/);
    expect(content).toMatch(/factcheck: 2/);
  });

  // ---------------------------------------------------------------------------
  // Error resilience
  // ---------------------------------------------------------------------------

  it('returns a digestPath even when events directory is empty', async () => {
    // No events at all
    const { digestPath } = await aggregate({ directory: testDir, trigger: 'on-demand' });
    expect(typeof digestPath).toBe('string');
    expect(digestPath.length).toBeGreaterThan(0);
  });

  it('never throws even on malformed JSONL', async () => {
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(eventsDir, 'hook-events.jsonl'), 'not json\n{broken\n', 'utf-8');

    await expect(
      aggregate({ directory: testDir, trigger: 'on-demand' })
    ).resolves.toBeDefined();
  });
});

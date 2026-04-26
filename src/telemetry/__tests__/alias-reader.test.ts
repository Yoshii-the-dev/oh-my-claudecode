/**
 * alias-reader.test.ts
 *
 * Covers: read-only adapters for delegation-audit.jsonl, agent-replay-*.jsonl,
 * sessions/*.json, self-improve/tracking/raw_data.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readDelegationAudit,
  readAgentReplay,
  listAgentReplaySessions,
  readSessionSnapshot,
  listSessions,
  readSelfImproveRawData,
} from '../alias-reader.js';

describe('telemetry/alias-reader', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-alias-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.omc', 'logs'), { recursive: true });
    mkdirSync(join(testDir, '.omc', 'state', 'sessions'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('readDelegationAudit', () => {
    it('returns empty array when file does not exist', () => {
      expect(readDelegationAudit(testDir)).toEqual([]);
    });

    it('parses valid JSONL entries', () => {
      const entry1 = { timestamp: '2026-01-01T00:00:00.000Z', tool: 'Edit', filePath: '/src/a.ts', decision: 'allowed', reason: 'allowed_path' };
      const entry2 = { timestamp: '2026-01-01T00:01:00.000Z', tool: 'Write', filePath: '/src/b.ts', decision: 'warned', reason: 'source_file' };
      const filePath = join(testDir, '.omc', 'logs', 'delegation-audit.jsonl');
      writeFileSync(filePath, [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n') + '\n');

      const entries = readDelegationAudit(testDir);
      expect(entries.length).toBe(2);
      expect(entries[0].tool).toBe('Edit');
      expect(entries[1].decision).toBe('warned');
    });

    it('skips malformed lines without throwing', () => {
      const filePath = join(testDir, '.omc', 'logs', 'delegation-audit.jsonl');
      writeFileSync(filePath, 'not-json\n{"valid":"entry","timestamp":"t","tool":"T","filePath":"f","decision":"allowed","reason":"other"}\n');

      const entries = readDelegationAudit(testDir);
      expect(entries.length).toBe(1);
      expect(entries[0].tool).toBe('T');
    });
  });

  describe('readAgentReplay', () => {
    it('returns empty array when replay file does not exist', () => {
      expect(readAgentReplay(testDir, 'nonexistent-session')).toEqual([]);
    });

    it('reads entries from agent-replay-<sessionId>.jsonl', () => {
      const entry = { session_id: 'sess-1', agent_id: 'a1', agent_type: 'executor', event: 'start', ts: '2026-01-01T00:00:00.000Z' };
      const filePath = join(testDir, '.omc', 'logs', 'agent-replay-sess-1.jsonl');
      writeFileSync(filePath, JSON.stringify(entry) + '\n');

      const entries = readAgentReplay(testDir, 'sess-1');
      expect(entries.length).toBe(1);
      expect(entries[0].agent_id).toBe('a1');
    });
  });

  describe('listAgentReplaySessions', () => {
    it('returns empty array when no replay files exist', () => {
      expect(listAgentReplaySessions(testDir)).toEqual([]);
    });

    it('lists session IDs from agent-replay-*.jsonl files', () => {
      writeFileSync(join(testDir, '.omc', 'logs', 'agent-replay-sess-a.jsonl'), '');
      writeFileSync(join(testDir, '.omc', 'logs', 'agent-replay-sess-b.jsonl'), '');
      writeFileSync(join(testDir, '.omc', 'logs', 'other-file.log'), '');

      const sessions = listAgentReplaySessions(testDir);
      expect(sessions).toContain('sess-a');
      expect(sessions).toContain('sess-b');
      expect(sessions).not.toContain('other-file.log');
    });
  });

  describe('readSessionSnapshot', () => {
    it('returns null for nonexistent session', () => {
      expect(readSessionSnapshot(testDir, 'nonexistent')).toBeNull();
    });

    it('reads state from session directory', () => {
      const sessionDir = join(testDir, '.omc', 'state', 'sessions', 'test-session');
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'ralph-state.json'), JSON.stringify({ active: true, started_at: '2026-01-01T00:00:00.000Z' }));

      const snapshot = readSessionSnapshot(testDir, 'test-session');
      expect(snapshot).not.toBeNull();
      expect(snapshot!.session_id).toBe('test-session');
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      expect(listSessions(testDir)).toEqual([]);
    });

    it('lists session directory names', () => {
      mkdirSync(join(testDir, '.omc', 'state', 'sessions', 'session-1'), { recursive: true });
      mkdirSync(join(testDir, '.omc', 'state', 'sessions', 'session-2'), { recursive: true });

      const sessions = listSessions(testDir);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
    });
  });

  describe('readSelfImproveRawData', () => {
    it('returns null when raw_data.json does not exist', () => {
      expect(readSelfImproveRawData(testDir)).toBeNull();
    });

    it('reads and parses raw_data.json', () => {
      const rawData = {
        generation: 3,
        leader: 'candidate-2',
        candidates: [
          { candidate_id: 'c1', score: 0.8 },
          { candidate_id: 'c2', score: 0.9 },
        ],
      };
      const selfImproveDir = join(testDir, '.omc', 'self-improve', 'tracking');
      mkdirSync(selfImproveDir, { recursive: true });
      writeFileSync(join(selfImproveDir, 'raw_data.json'), JSON.stringify(rawData));

      const data = readSelfImproveRawData(testDir);
      expect(data).not.toBeNull();
      expect(data!.generation).toBe(3);
      expect(data!.leader).toBe('candidate-2');
      expect(data!.candidates!.length).toBe(2);
    });

    it('returns null on malformed JSON', () => {
      const selfImproveDir = join(testDir, '.omc', 'self-improve', 'tracking');
      mkdirSync(selfImproveDir, { recursive: true });
      writeFileSync(join(selfImproveDir, 'raw_data.json'), 'not valid json {{{');

      expect(readSelfImproveRawData(testDir)).toBeNull();
    });
  });
});

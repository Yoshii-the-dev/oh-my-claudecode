/**
 * Alias Reader — Read-only adapters for existing OMC data files.
 *
 * Reads from:
 * - delegation-audit.jsonl
 * - agent-replay-*.jsonl
 * - sessions/*.json
 * - self-improve/tracking/raw_data.json
 *
 * READ-ONLY — these functions never write to the source files.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getOmcRoot } from '../lib/worktree-paths.js';

// ---------------------------------------------------------------------------
// delegation-audit.jsonl
// ---------------------------------------------------------------------------

export interface DelegationAuditEntry {
  timestamp: string;
  tool: string;
  filePath: string;
  decision: 'allowed' | 'warned' | 'blocked';
  reason: string;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Read all entries from delegation-audit.jsonl.
 * Returns empty array on error. READ-ONLY.
 */
export function readDelegationAudit(directory: string): DelegationAuditEntry[] {
  const filePath = join(getOmcRoot(directory), 'logs', 'delegation-audit.jsonl');
  return readJsonlFile<DelegationAuditEntry>(filePath);
}

// ---------------------------------------------------------------------------
// agent-replay-*.jsonl
// ---------------------------------------------------------------------------

export interface AgentReplayEntry {
  session_id: string;
  agent_id: string;
  agent_type: string;
  event: string;
  ts: string;
  [key: string]: unknown;
}

/**
 * Read all agent replay entries for a given session.
 * Returns entries from agent-replay-<sessionId>.jsonl. READ-ONLY.
 */
export function readAgentReplay(directory: string, sessionId: string): AgentReplayEntry[] {
  const omcRoot = getOmcRoot(directory);
  const filePath = join(omcRoot, 'logs', `agent-replay-${sessionId}.jsonl`);
  return readJsonlFile<AgentReplayEntry>(filePath);
}

/**
 * List all agent-replay-*.jsonl files and return their session IDs. READ-ONLY.
 */
export function listAgentReplaySessions(directory: string): string[] {
  const logsDir = join(getOmcRoot(directory), 'logs');
  if (!existsSync(logsDir)) return [];

  try {
    return readdirSync(logsDir)
      .filter(f => f.startsWith('agent-replay-') && f.endsWith('.jsonl'))
      .map(f => f.replace(/^agent-replay-/, '').replace(/\.jsonl$/, ''));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// sessions/*.json
// ---------------------------------------------------------------------------

export interface SessionSnapshot {
  session_id: string;
  started_at?: string;
  ended_at?: string;
  [key: string]: unknown;
}

/**
 * Read session state file for a given session ID. READ-ONLY.
 */
export function readSessionSnapshot(directory: string, sessionId: string): SessionSnapshot | null {
  const sessionDir = join(getOmcRoot(directory), 'state', 'sessions', sessionId);
  if (!existsSync(sessionDir)) return null;

  // Try ralph-state.json or any *-state.json as representative snapshot
  try {
    const files = readdirSync(sessionDir).filter(f => f.endsWith('-state.json'));
    if (files.length === 0) return null;

    const content = readFileSync(join(sessionDir, files[0]), 'utf-8');
    const parsed = JSON.parse(content);
    return { session_id: sessionId, ...parsed };
  } catch {
    return null;
  }
}

/**
 * List all session IDs that have state directories. READ-ONLY.
 */
export function listSessions(directory: string): string[] {
  const sessionsDir = join(getOmcRoot(directory), 'state', 'sessions');
  if (!existsSync(sessionsDir)) return [];

  try {
    return readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// self-improve/tracking/raw_data.json
// ---------------------------------------------------------------------------

export interface SelfImproveCandidateScore {
  candidate_id: string;
  score?: number;
  wins?: number;
  losses?: number;
  [key: string]: unknown;
}

export interface SelfImproveRawData {
  generation?: number;
  leader?: string;
  candidates?: SelfImproveCandidateScore[];
  [key: string]: unknown;
}

/**
 * Read self-improve raw_data.json. READ-ONLY.
 * Returns null if the file does not exist.
 */
export function readSelfImproveRawData(directory: string): SelfImproveRawData | null {
  const filePath = join(getOmcRoot(directory), 'self-improve', 'tracking', 'raw_data.json');
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SelfImproveRawData;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readJsonlFile<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
}

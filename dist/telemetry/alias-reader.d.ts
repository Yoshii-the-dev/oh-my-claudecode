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
export declare function readDelegationAudit(directory: string): DelegationAuditEntry[];
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
export declare function readAgentReplay(directory: string, sessionId: string): AgentReplayEntry[];
/**
 * List all agent-replay-*.jsonl files and return their session IDs. READ-ONLY.
 */
export declare function listAgentReplaySessions(directory: string): string[];
export interface SessionSnapshot {
    session_id: string;
    started_at?: string;
    ended_at?: string;
    [key: string]: unknown;
}
/**
 * Read session state file for a given session ID. READ-ONLY.
 */
export declare function readSessionSnapshot(directory: string, sessionId: string): SessionSnapshot | null;
/**
 * List all session IDs that have state directories. READ-ONLY.
 */
export declare function listSessions(directory: string): string[];
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
export declare function readSelfImproveRawData(directory: string): SelfImproveRawData | null;
//# sourceMappingURL=alias-reader.d.ts.map
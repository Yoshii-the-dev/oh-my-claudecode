/**
 * Telemetry Public Exports
 *
 * Phase 1 capture layer — append-only JSONL streams with version attribution.
 */

// Core writer
export { emit, flush, getPendingBufferSize, clearPendingBuffer } from './writer.js';
export type { StreamName, EmitOptions } from './writer.js';

// High-level helpers
export {
  emitToolCall,
  emitAgentHandoff,
  emitLlmInteraction,
  emitHookEvent,
  emitVerdict,
  emitUserCorrection,
} from './emit.js';
export type {
  EmitBaseContext,
  EmitToolCallOptions,
  EmitAgentHandoffOptions,
  EmitLlmInteractionOptions,
  EmitHookEventOptions,
  EmitVerdictOptions,
  EmitUserCorrectionOptions,
} from './emit.js';

// Schemas & types
export type {
  BaseEnvelope,
  AgentHandoffPayload,
  VerdictPayload,
  SkillEventPayload,
  HookEventPayload,
  LlmInteractionPayload,
  TelemetryEnvelope,
} from './schemas.js';
export { validatePayload } from './schemas.js';

// Version attribution
export {
  getBaseAttribution,
  getAgentPromptHash,
  getSkillContentHash,
  getHookVersionHash,
  getOrCreateInstallId,
  resetAttributionCaches,
} from './version-attribution.js';

// PII redaction
export { hashFilePath, redactPrompt, redactPayload, getOrCreateSalt, resetSaltCache } from './redact.js';

// Config
export { loadTelemetryConfig, isTelemetryEnabled } from './config.js';
export type { TelemetryConfig } from './config.js';

// Aggregator
export { aggregate } from './aggregator.js';
export type { AggregateOptions } from './aggregator.js';

// Rotator
export { rotateIfNeeded, gcArchives } from './rotator.js';

// Export stub (Phase 4)
export { exportDigests } from './export.js';
export type { ExportTarget, ExportRange } from './export.js';

// Alias readers (read-only adapters)
export {
  readDelegationAudit,
  readAgentReplay,
  listAgentReplaySessions,
  readSessionSnapshot,
  listSessions,
  readSelfImproveRawData,
} from './alias-reader.js';
export type {
  DelegationAuditEntry,
  AgentReplayEntry,
  SessionSnapshot,
  SelfImproveCandidateScore,
  SelfImproveRawData,
} from './alias-reader.js';

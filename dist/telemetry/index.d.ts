/**
 * Telemetry Public Exports
 *
 * Phase 1 capture layer — append-only JSONL streams with version attribution.
 */
export { emit, flush, getPendingBufferSize, clearPendingBuffer } from './writer.js';
export type { StreamName, EmitOptions } from './writer.js';
export { emitToolCall, emitAgentHandoff, emitLlmInteraction, emitHookEvent, emitProductCycleEvent, emitVerdict, emitUserCorrection, } from './emit.js';
export type { EmitBaseContext, EmitToolCallOptions, EmitAgentHandoffOptions, EmitLlmInteractionOptions, EmitHookEventOptions, EmitProductCycleEventOptions, EmitVerdictOptions, EmitUserCorrectionOptions, } from './emit.js';
export type { BaseEnvelope, AgentHandoffPayload, VerdictPayload, SkillEventPayload, HookEventPayload, LlmInteractionPayload, ProductCycleEventPayload, TelemetryEnvelope, } from './schemas.js';
export { validatePayload } from './schemas.js';
export { getBaseAttribution, getAgentPromptHash, getSkillContentHash, getHookVersionHash, getOrCreateInstallId, resetAttributionCaches, } from './version-attribution.js';
export { hashFilePath, redactPrompt, redactPayload, getOrCreateSalt, resetSaltCache } from './redact.js';
export { loadTelemetryConfig, isTelemetryEnabled } from './config.js';
export type { TelemetryConfig } from './config.js';
export { aggregate } from './aggregator.js';
export type { AggregateOptions } from './aggregator.js';
export { rotateIfNeeded, gcArchives } from './rotator.js';
export { exportDigests } from './export.js';
export type { ExportTarget, ExportRange } from './export.js';
export { readDelegationAudit, readAgentReplay, listAgentReplaySessions, readSessionSnapshot, listSessions, readSelfImproveRawData, } from './alias-reader.js';
export type { DelegationAuditEntry, AgentReplayEntry, SessionSnapshot, SelfImproveCandidateScore, SelfImproveRawData, } from './alias-reader.js';
//# sourceMappingURL=index.d.ts.map
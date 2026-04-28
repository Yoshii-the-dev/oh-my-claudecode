/**
 * Telemetry Public Exports
 *
 * Phase 1 capture layer — append-only JSONL streams with version attribution.
 */
// Core writer
export { emit, flush, getPendingBufferSize, clearPendingBuffer } from './writer.js';
// High-level helpers
export { emitToolCall, emitAgentHandoff, emitLlmInteraction, emitHookEvent, emitProductCycleEvent, emitVerdict, emitUserCorrection, } from './emit.js';
export { validatePayload } from './schemas.js';
// Version attribution
export { getBaseAttribution, getAgentPromptHash, getSkillContentHash, getHookVersionHash, getOrCreateInstallId, resetAttributionCaches, } from './version-attribution.js';
// PII redaction
export { hashFilePath, redactPrompt, redactPayload, getOrCreateSalt, resetSaltCache } from './redact.js';
// Config
export { loadTelemetryConfig, isTelemetryEnabled } from './config.js';
// Aggregator
export { aggregate } from './aggregator.js';
// Rotator
export { rotateIfNeeded, gcArchives } from './rotator.js';
// Export stub (Phase 4)
export { exportDigests } from './export.js';
// Alias readers (read-only adapters)
export { readDelegationAudit, readAgentReplay, listAgentReplaySessions, readSessionSnapshot, listSessions, readSelfImproveRawData, } from './alias-reader.js';
//# sourceMappingURL=index.js.map
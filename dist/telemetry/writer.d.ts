/**
 * Telemetry Writer
 *
 * Append-only JSONL writer with:
 * - Kill-switch via OMC_TELEMETRY_DISABLE=1
 * - File rotation at maxFileBytes (default 8 MB)
 * - Missing-dir auto-create
 * - Error swallow — never throws, failures go to stderr
 * - In-process buffer with flush() for SessionEnd
 */
import type { StreamName } from './schemas.js';
export type { StreamName };
export interface EmitOptions {
    /** Project root directory. Used to locate .omc/telemetry/ and version-attribution. */
    directory: string;
    /** Stream slug — picks the target JSONL file. */
    stream: StreamName;
    /** Stream-specific payload. Must NOT include attribution fields. */
    payload: Record<string, unknown>;
}
/**
 * Fire-and-forget structured telemetry emit.
 * Auto-populates base attribution + context-specific hash.
 * Callers must NOT pass attribution fields.
 * Never throws.
 */
export declare function emit(options: EmitOptions, maxFileBytes?: number): Promise<void>;
/**
 * Flush any in-process buffer and release pending writes.
 * Called by SessionEnd hook before aggregator runs.
 */
export declare function flush(_directory?: string): Promise<void>;
/**
 * Get the current buffer size (for testing).
 * @internal
 */
export declare function getPendingBufferSize(): number;
/**
 * Clear the pending buffer (for testing).
 * @internal
 */
export declare function clearPendingBuffer(): void;
//# sourceMappingURL=writer.d.ts.map
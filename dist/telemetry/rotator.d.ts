/**
 * Telemetry Rotator
 *
 * Rotates JSONL stream files when they exceed 8 MB or are older than 24 hours.
 * Archives are written as .jsonl.gz using node:zlib gzip compression.
 *
 * DEVIATION FROM PLAN SECTION 4.2:
 * The plan specifies .jsonl.zst (zstd) archives. This implementation uses
 * .jsonl.gz (gzip via node:zlib) instead. Rationale: zstd would require an
 * additional native/wasm dependency. Per the executor brief, the user explicitly
 * limited new production dependencies to Zod only. node:zlib ships with Node.js
 * and adds no new deps. This deviation is documented here per executor brief
 * instructions.
 *
 * Exports:
 * - rotateIfNeeded(directory, stream): rotate if >8 MB or >24 h old
 * - gcArchives(directory): remove archives older than 30 days
 */
import type { StreamName } from './schemas.js';
/**
 * Rotate the JSONL file for `stream` if it exceeds 8 MB or is older than 24 h.
 * Archives are compressed with gzip → .jsonl.gz.
 * Never throws; rotation failures are silently ignored.
 */
export declare function rotateIfNeeded(directory: string, stream: StreamName): Promise<void>;
/**
 * Remove archive files older than 30 days from .omc/telemetry/archive/.
 * Never throws.
 */
export declare function gcArchives(directory: string): Promise<void>;
//# sourceMappingURL=rotator.d.ts.map
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

import {
  existsSync,
  statSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { StreamName } from './schemas.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 8 * 1024 * 1024;       // 8 MB
const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_ARCHIVE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventsDir(directory: string): string {
  return join(directory, '.omc', 'telemetry', 'events');
}

function archiveDir(directory: string): string {
  return join(directory, '.omc', 'telemetry', 'archive');
}

function streamFilePath(directory: string, stream: StreamName): string {
  return join(eventsDir(directory), `${stream}.jsonl`);
}

function buildArchiveName(stream: StreamName): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stream}-${ts}.jsonl.gz`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rotate the JSONL file for `stream` if it exceeds 8 MB or is older than 24 h.
 * Archives are compressed with gzip → .jsonl.gz.
 * Never throws; rotation failures are silently ignored.
 */
export async function rotateIfNeeded(directory: string, stream: StreamName): Promise<void> {
  const filePath = streamFilePath(directory, stream);

  try {
    if (!existsSync(filePath)) return;

    const stats = statSync(filePath);
    const sizeExceeded = stats.size >= MAX_FILE_BYTES;
    const ageExceeded = Date.now() - stats.mtimeMs >= MAX_FILE_AGE_MS;

    if (!sizeExceeded && !ageExceeded) return;

    // Read, compress, write to archive
    const content = readFileSync(filePath);
    const compressed = gzipSync(content);

    const archivePath = join(archiveDir(directory), buildArchiveName(stream));
    mkdirSync(archiveDir(directory), { recursive: true });
    writeFileSync(archivePath, compressed);

    // Truncate (overwrite with empty) rather than unlink so concurrent
    // writers see an empty file rather than ENOENT.
    writeFileSync(filePath, '');
  } catch {
    // Silently ignore rotation failures — telemetry must never block callers
  }
}

/**
 * Remove archive files older than 30 days from .omc/telemetry/archive/.
 * Never throws.
 */
export async function gcArchives(directory: string): Promise<void> {
  const dir = archiveDir(directory);
  if (!existsSync(dir)) return;

  try {
    const now = Date.now();
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl.gz')) continue;
      const fullPath = join(dir, entry);
      try {
        const stats = statSync(fullPath);
        if (now - stats.mtimeMs >= MAX_ARCHIVE_AGE_MS) {
          unlinkSync(fullPath);
        }
      } catch {
        // Skip individual file errors
      }
    }
  } catch {
    // Silently ignore
  }
}

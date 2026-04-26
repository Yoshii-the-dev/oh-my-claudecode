/**
 * PII Redaction
 *
 * Hashes file paths and truncates+hashes prompts before telemetry emission.
 * Salt is persisted at .omc/telemetry/.salt (gitignored).
 * No PII is ever stored in plaintext.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROMPT_MAX_CHARS = 200;
const SALT_HEX_LENGTH = 32; // 16 bytes = 32 hex chars

// In-process cache for salt (one per directory)
const saltCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Salt management
// ---------------------------------------------------------------------------

/**
 * Get or create the per-install salt.
 * Persisted at .omc/telemetry/.salt (mode 0600, gitignored).
 */
export function getOrCreateSalt(directory: string): string {
  if (saltCache.has(directory)) return saltCache.get(directory)!;

  const telemetryDir = join(directory, '.omc', 'telemetry');
  const saltPath = join(telemetryDir, '.salt');

  if (existsSync(saltPath)) {
    try {
      const existing = readFileSync(saltPath, 'utf-8').trim();
      if (existing.length === SALT_HEX_LENGTH) {
        saltCache.set(directory, existing);
        return existing;
      }
    } catch {
      // Fall through to create new salt
    }
  }

  const salt = randomBytes(16).toString('hex');
  try {
    mkdirSync(telemetryDir, { recursive: true });
    writeFileSync(saltPath, salt, { mode: 0o600 });
  } catch {
    // Silently fail — use in-memory only
  }

  saltCache.set(directory, salt);
  return salt;
}

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/**
 * Hash a file path with the per-install salt.
 * Returns first 16 hex chars of sha256(salt + path).
 */
export function hashFilePath(directory: string, filePath: string): string {
  const salt = getOrCreateSalt(directory);
  return createHash('sha256')
    .update(salt)
    .update(filePath)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Truncate a prompt to PROMPT_MAX_CHARS then hash with salt.
 * Returns { truncated: string, hash: string }.
 */
export function redactPrompt(
  directory: string,
  prompt: string,
): { truncated: string; hash: string } {
  const truncated = prompt.slice(0, PROMPT_MAX_CHARS);
  const salt = getOrCreateSalt(directory);
  const hash = createHash('sha256')
    .update(salt)
    .update(truncated)
    .digest('hex')
    .slice(0, 16);
  return { truncated, hash };
}

/**
 * Redact a payload object in-place:
 * - Any field named "file_path", "path", "filePath" → hashed
 * - Any field named "prompt", "content" → truncated + hashed
 * Returns a new object (does not mutate input).
 */
export function redactPayload(
  directory: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };

  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'string') continue;

    if (['file_path', 'path', 'filePath'].includes(key)) {
      result[key] = hashFilePath(directory, value);
    } else if (['prompt', 'content', 'task_description'].includes(key)) {
      const { truncated, hash } = redactPrompt(directory, value);
      result[key] = truncated;
      result[`${key}_hash`] = hash;
    }
  }

  return result;
}

/**
 * Reset salt cache (for testing only).
 * @internal
 */
export function resetSaltCache(): void {
  saltCache.clear();
}

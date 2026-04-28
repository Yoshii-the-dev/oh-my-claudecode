/**
 * PII Redaction
 *
 * Hashes file paths and truncates+hashes prompts before telemetry emission.
 * Salt is persisted at .omc/telemetry/.salt (gitignored).
 * No PII is ever stored in plaintext.
 */
/**
 * Get or create the per-install salt.
 * Persisted at .omc/telemetry/.salt (mode 0600, gitignored).
 */
export declare function getOrCreateSalt(directory: string): string;
/**
 * Hash a file path with the per-install salt.
 * Returns first 16 hex chars of sha256(salt + path).
 */
export declare function hashFilePath(directory: string, filePath: string): string;
/**
 * Truncate a prompt to PROMPT_MAX_CHARS then hash with salt.
 * Returns { truncated: string, hash: string }.
 */
export declare function redactPrompt(directory: string, prompt: string): {
    truncated: string;
    hash: string;
};
/**
 * Redact a payload object in-place:
 * - Any field named "file_path", "path", "filePath" → hashed
 * - Any field named "prompt", "content" → truncated + hashed
 * Returns a new object (does not mutate input).
 */
export declare function redactPayload(directory: string, payload: Record<string, unknown>): Record<string, unknown>;
/**
 * Reset salt cache (for testing only).
 * @internal
 */
export declare function resetSaltCache(): void;
//# sourceMappingURL=redact.d.ts.map
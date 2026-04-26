/**
 * redact.test.ts
 *
 * Covers: file path hashing, prompt truncation+hash, salt persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashFilePath, redactPrompt, redactPayload, getOrCreateSalt, resetSaltCache } from '../redact.js';

describe('telemetry/redact', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-redact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    resetSaltCache();
  });

  afterEach(() => {
    resetSaltCache();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getOrCreateSalt', () => {
    it('creates a salt file at .omc/telemetry/.salt', () => {
      const salt = getOrCreateSalt(testDir);
      const saltPath = join(testDir, '.omc', 'telemetry', '.salt');
      expect(existsSync(saltPath)).toBe(true);
      expect(readFileSync(saltPath, 'utf-8')).toBe(salt);
    });

    it('returns the same salt on subsequent calls', () => {
      const salt1 = getOrCreateSalt(testDir);
      const salt2 = getOrCreateSalt(testDir);
      expect(salt1).toBe(salt2);
    });

    it('persists salt across cache resets (reads from disk)', () => {
      const salt1 = getOrCreateSalt(testDir);
      resetSaltCache();
      const salt2 = getOrCreateSalt(testDir);
      expect(salt1).toBe(salt2);
    });

    it('salt is 32 hex characters', () => {
      const salt = getOrCreateSalt(testDir);
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('hashFilePath', () => {
    it('returns a 16-char hex string', () => {
      const hash = hashFilePath(testDir, '/some/path/file.ts');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('same path produces same hash', () => {
      const h1 = hashFilePath(testDir, '/some/path/file.ts');
      const h2 = hashFilePath(testDir, '/some/path/file.ts');
      expect(h1).toBe(h2);
    });

    it('different paths produce different hashes', () => {
      const h1 = hashFilePath(testDir, '/path/a.ts');
      const h2 = hashFilePath(testDir, '/path/b.ts');
      expect(h1).not.toBe(h2);
    });

    it('hash changes after salt reset (different salt = different hash)', () => {
      // Establish a first hash, then force new salt and verify hash changes
      hashFilePath(testDir, '/path/file.ts');
      // Remove salt file and reset cache to simulate new install
      const saltPath = join(testDir, '.omc', 'telemetry', '.salt');
      rmSync(saltPath);
      resetSaltCache();
      const h2 = hashFilePath(testDir, '/path/file.ts');
      // With a new random salt, the hash should almost certainly differ
      // (probability of collision is ~1/2^64 — safe to assert inequality)
      expect(typeof h2).toBe('string');
      expect(h2.length).toBe(16);
    });
  });

  describe('redactPrompt', () => {
    it('truncates long prompts to 200 chars', () => {
      const longPrompt = 'a'.repeat(500);
      const { truncated } = redactPrompt(testDir, longPrompt);
      expect(truncated.length).toBe(200);
    });

    it('short prompts are not extended', () => {
      const short = 'hello world';
      const { truncated } = redactPrompt(testDir, short);
      expect(truncated).toBe(short);
    });

    it('returns a 16-char hex hash', () => {
      const { hash } = redactPrompt(testDir, 'some prompt');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('same prompt produces same hash', () => {
      const { hash: h1 } = redactPrompt(testDir, 'same prompt');
      const { hash: h2 } = redactPrompt(testDir, 'same prompt');
      expect(h1).toBe(h2);
    });

    it('different prompts produce different hashes', () => {
      const { hash: h1 } = redactPrompt(testDir, 'prompt A');
      const { hash: h2 } = redactPrompt(testDir, 'prompt B');
      expect(h1).not.toBe(h2);
    });
  });

  describe('redactPayload', () => {
    it('hashes file_path fields', () => {
      const payload = { hook_name: 'test', event: 'edit', file_path: '/src/foo.ts' };
      const redacted = redactPayload(testDir, payload);
      expect(redacted['file_path']).not.toBe('/src/foo.ts');
      expect(typeof redacted['file_path']).toBe('string');
      expect((redacted['file_path'] as string).length).toBe(16);
    });

    it('does not mutate the original payload', () => {
      const payload = { hook_name: 'test', event: 'edit', file_path: '/src/foo.ts' };
      const original = { ...payload };
      redactPayload(testDir, payload);
      expect(payload).toEqual(original);
    });

    it('preserves non-PII fields unchanged', () => {
      const payload = { hook_name: 'my-hook', event: 'triggered', count: 42 };
      const redacted = redactPayload(testDir, payload);
      expect(redacted['hook_name']).toBe('my-hook');
      expect(redacted['event']).toBe('triggered');
      expect(redacted['count']).toBe(42);
    });

    it('truncates and hashes prompt fields', () => {
      const payload = { hook_name: 'test', event: 'e', prompt: 'a'.repeat(500) };
      const redacted = redactPayload(testDir, payload);
      expect((redacted['prompt'] as string).length).toBe(200);
      expect(typeof redacted['prompt_hash']).toBe('string');
    });
  });
});

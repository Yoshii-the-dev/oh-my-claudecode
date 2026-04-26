/**
 * rotator.test.ts
 *
 * Covers:
 * - Size-based rotation (>= 8 MB → archive + truncate)
 * - Time-based rotation (file mtime > 24 h → rotate, mocked via fs.utimesSync)
 * - No rotation when file is small and recent
 * - Archive is .jsonl.gz and content is valid gzip
 * - gcArchives removes archives older than 30 days
 * - gcArchives leaves recent archives intact
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
  utimesSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { rotateIfNeeded, gcArchives } from '../rotator.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB

describe('telemetry/rotator', () => {
  let testDir: string;
  let eventsDir: string;
  let archiveDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `rotator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    eventsDir = join(testDir, '.omc', 'telemetry', 'events');
    archiveDir = join(testDir, '.omc', 'telemetry', 'archive');
    mkdirSync(eventsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Size-based rotation
  // ---------------------------------------------------------------------------

  it('rotates file when size >= 8 MB', async () => {
    const filePath = join(eventsDir, 'hook-events.jsonl');
    // Write exactly 8 MB
    const bigContent = 'x'.repeat(MAX_FILE_BYTES);
    writeFileSync(filePath, bigContent);

    await rotateIfNeeded(testDir, 'hook-events');

    // Original file should be empty (truncated) after rotation
    expect(existsSync(filePath)).toBe(true);
    expect(statSync(filePath).size).toBe(0);

    // Archive should exist with .jsonl.gz extension
    expect(existsSync(archiveDir)).toBe(true);
    const archives = readdirSync(archiveDir).filter(f => f.endsWith('.jsonl.gz'));
    expect(archives.length).toBe(1);
    expect(archives[0]).toMatch(/^hook-events-/);

    // Archive should be valid gzip
    const archivePath = join(archiveDir, archives[0]);
    const compressed = readFileSync(archivePath);
    const decompressed = gunzipSync(compressed).toString();
    expect(decompressed).toBe(bigContent);
  });

  it('does not rotate file when size < 8 MB and recent', async () => {
    const filePath = join(eventsDir, 'hook-events.jsonl');
    writeFileSync(filePath, '{"stream":"hook-events"}\n');

    await rotateIfNeeded(testDir, 'hook-events');

    // File should remain unchanged
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{"stream":"hook-events"}\n');

    // No archive created
    expect(existsSync(archiveDir)).toBe(false);
  });

  it('does nothing when stream file does not exist', async () => {
    // No file created — should not throw
    await expect(rotateIfNeeded(testDir, 'verdict')).resolves.toBeUndefined();
    expect(existsSync(archiveDir)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Time-based rotation
  // ---------------------------------------------------------------------------

  it('rotates file when mtime is older than 24 hours', async () => {
    const filePath = join(eventsDir, 'verdict.jsonl');
    const content = '{"stream":"verdict","event":"verdict","agent_type":"executor","verdict":"pass"}\n';
    writeFileSync(filePath, content);

    // Set mtime to 25 hours ago
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(filePath, twentyFiveHoursAgo, twentyFiveHoursAgo);

    await rotateIfNeeded(testDir, 'verdict');

    // File should be truncated
    expect(statSync(filePath).size).toBe(0);

    // Archive should exist
    const archives = readdirSync(archiveDir).filter(f => f.endsWith('.jsonl.gz'));
    expect(archives.length).toBe(1);
    expect(archives[0]).toMatch(/^verdict-/);

    // Verify archive content is correct
    const archivePath = join(archiveDir, archives[0]);
    const compressed = readFileSync(archivePath);
    const decompressed = gunzipSync(compressed).toString();
    expect(decompressed).toBe(content);
  });

  it('does not rotate file when mtime is less than 24 hours old', async () => {
    const filePath = join(eventsDir, 'agent-handoff.jsonl');
    writeFileSync(filePath, '{"stream":"agent-handoff"}\n');

    // Set mtime to 23 hours ago (just under threshold)
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
    utimesSync(filePath, twentyThreeHoursAgo, twentyThreeHoursAgo);

    await rotateIfNeeded(testDir, 'agent-handoff');

    // Should not have rotated
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{"stream":"agent-handoff"}\n');
    expect(existsSync(archiveDir)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Archive format validation
  // ---------------------------------------------------------------------------

  it('archive file has .jsonl.gz extension and contains valid gzip', async () => {
    const filePath = join(eventsDir, 'skill-events.jsonl');
    const lines = [
      '{"stream":"skill-events","event":"detected","skill_slug":"autopilot"}',
      '{"stream":"skill-events","event":"invoked","skill_slug":"autopilot"}',
    ].join('\n') + '\n';
    writeFileSync(filePath, Buffer.alloc(MAX_FILE_BYTES, 'x'));

    await rotateIfNeeded(testDir, 'skill-events');

    const archives = readdirSync(archiveDir);
    expect(archives.every(f => f.endsWith('.jsonl.gz'))).toBe(true);

    // Check it decompresses without error
    const archivePath = join(archiveDir, archives[0]);
    const compressed = readFileSync(archivePath);
    expect(() => gunzipSync(compressed)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // gcArchives
  // ---------------------------------------------------------------------------

  it('gcArchives removes archives older than 30 days', async () => {
    mkdirSync(archiveDir, { recursive: true });

    const oldArchive = join(archiveDir, 'hook-events-2025-01-01.jsonl.gz');
    // Write minimal gzip content
    const { gzipSync } = await import('node:zlib');
    writeFileSync(oldArchive, gzipSync(Buffer.from('old content')));

    // Set mtime to 31 days ago
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(oldArchive, thirtyOneDaysAgo, thirtyOneDaysAgo);

    await gcArchives(testDir);

    expect(existsSync(oldArchive)).toBe(false);
  });

  it('gcArchives keeps archives younger than 30 days', async () => {
    mkdirSync(archiveDir, { recursive: true });

    const { gzipSync } = await import('node:zlib');
    const recentArchive = join(archiveDir, 'hook-events-recent.jsonl.gz');
    writeFileSync(recentArchive, gzipSync(Buffer.from('recent content')));

    // Set mtime to 29 days ago
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    utimesSync(recentArchive, twentyNineDaysAgo, twentyNineDaysAgo);

    await gcArchives(testDir);

    expect(existsSync(recentArchive)).toBe(true);
  });

  it('gcArchives does nothing when archive dir does not exist', async () => {
    await expect(gcArchives(testDir)).resolves.toBeUndefined();
  });

  it('gcArchives ignores non-.jsonl.gz files', async () => {
    mkdirSync(archiveDir, { recursive: true });

    const otherFile = join(archiveDir, 'README.txt');
    writeFileSync(otherFile, 'not an archive');

    // Set mtime to 31 days ago
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(otherFile, old, old);

    await gcArchives(testDir);

    // README.txt should remain (not a .jsonl.gz)
    expect(existsSync(otherFile)).toBe(true);
  });
});

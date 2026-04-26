/**
 * version-attribution.test.ts
 *
 * Covers: plugin_version from package.json (4.22.0); install_id created once
 * and reused; hashes stable across calls; omc_config_hash is 16-char hex.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getBaseAttribution,
  getOrCreateInstallId,
  getAgentPromptHash,
  getSkillContentHash,
  getHookVersionHash,
  resetAttributionCaches,
} from '../version-attribution.js';

describe('telemetry/version-attribution', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-va-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, '.omc', 'telemetry'), { recursive: true });
    mkdirSync(join(testDir, '.claude'), { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({ version: '4.22.0' }));
    resetAttributionCaches();
  });

  afterEach(() => {
    resetAttributionCaches();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getBaseAttribution', () => {
    it('plugin_version reads from package.json (4.22.0)', () => {
      const { plugin_version } = getBaseAttribution(testDir);
      expect(plugin_version).toBe('4.22.0');
    });

    it('omc_config_hash is a 16-char hex string', () => {
      const { omc_config_hash } = getBaseAttribution(testDir);
      expect(omc_config_hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('install_id is a non-empty string', () => {
      const { install_id } = getBaseAttribution(testDir);
      expect(typeof install_id).toBe('string');
      expect(install_id.length).toBeGreaterThan(0);
    });

    it('all three fields are present', () => {
      const attr = getBaseAttribution(testDir);
      expect(attr).toHaveProperty('plugin_version');
      expect(attr).toHaveProperty('omc_config_hash');
      expect(attr).toHaveProperty('install_id');
    });
  });

  describe('getOrCreateInstallId', () => {
    it('creates .install-id file on first call', () => {
      const id = getOrCreateInstallId(testDir);
      const idPath = join(testDir, '.omc', 'telemetry', '.install-id');
      expect(existsSync(idPath)).toBe(true);
      expect(readFileSync(idPath, 'utf-8').trim()).toBe(id);
    });

    it('returns same install_id on repeated calls (in-process cache)', () => {
      const id1 = getOrCreateInstallId(testDir);
      const id2 = getOrCreateInstallId(testDir);
      expect(id1).toBe(id2);
    });

    it('persists install_id across cache resets (reads from disk)', () => {
      const id1 = getOrCreateInstallId(testDir);
      resetAttributionCaches();
      const id2 = getOrCreateInstallId(testDir);
      expect(id1).toBe(id2);
    });

    it('install_id looks like a UUID', () => {
      const id = getOrCreateInstallId(testDir);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('getAgentPromptHash', () => {
    it('returns undefined when agent file does not exist', () => {
      const hash = getAgentPromptHash(testDir, 'nonexistent-agent');
      expect(hash).toBeUndefined();
    });

    it('returns 16-char hex hash when agent file exists', () => {
      mkdirSync(join(testDir, 'agents'), { recursive: true });
      writeFileSync(join(testDir, 'agents', 'executor.md'), 'executor prompt content');
      const hash = getAgentPromptHash(testDir, 'executor');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('strips oh-my-claudecode: prefix', () => {
      mkdirSync(join(testDir, 'agents'), { recursive: true });
      writeFileSync(join(testDir, 'agents', 'executor.md'), 'executor content');
      const hashWithPrefix = getAgentPromptHash(testDir, 'oh-my-claudecode:executor');
      const hashWithout = getAgentPromptHash(testDir, 'executor');
      // Both should resolve to the same hash (same file)
      expect(hashWithPrefix).toMatch(/^[0-9a-f]{16}$/);
      expect(hashWithPrefix).toBe(hashWithout);
    });

    it('hash is stable across calls (cached)', () => {
      mkdirSync(join(testDir, 'agents'), { recursive: true });
      writeFileSync(join(testDir, 'agents', 'planner.md'), 'planner content');
      const h1 = getAgentPromptHash(testDir, 'planner');
      const h2 = getAgentPromptHash(testDir, 'planner');
      expect(h1).toBe(h2);
    });
  });

  describe('getSkillContentHash', () => {
    it('returns undefined when skill file does not exist', () => {
      const hash = getSkillContentHash(testDir, 'nonexistent-skill');
      expect(hash).toBeUndefined();
    });

    it('returns 16-char hex hash when SKILL.md exists', () => {
      mkdirSync(join(testDir, 'skills', 'my-skill'), { recursive: true });
      writeFileSync(join(testDir, 'skills', 'my-skill', 'SKILL.md'), 'skill content');
      const hash = getSkillContentHash(testDir, 'my-skill');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('hash is stable across calls', () => {
      mkdirSync(join(testDir, 'skills', 'my-skill'), { recursive: true });
      writeFileSync(join(testDir, 'skills', 'my-skill', 'SKILL.md'), 'skill content');
      const h1 = getSkillContentHash(testDir, 'my-skill');
      const h2 = getSkillContentHash(testDir, 'my-skill');
      expect(h1).toBe(h2);
    });
  });

  describe('getHookVersionHash', () => {
    it('returns undefined when hook file does not exist', () => {
      const hash = getHookVersionHash(testDir, 'nonexistent-hook');
      expect(hash).toBeUndefined();
    });

    it('returns 16-char hex hash when hook index.ts exists', () => {
      mkdirSync(join(testDir, 'src', 'hooks', 'my-hook'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'hooks', 'my-hook', 'index.ts'), 'hook content');
      const hash = getHookVersionHash(testDir, 'my-hook');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('hash is stable across calls', () => {
      mkdirSync(join(testDir, 'src', 'hooks', 'my-hook'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'hooks', 'my-hook', 'index.ts'), 'hook content');
      const h1 = getHookVersionHash(testDir, 'my-hook');
      const h2 = getHookVersionHash(testDir, 'my-hook');
      expect(h1).toBe(h2);
    });
  });
});

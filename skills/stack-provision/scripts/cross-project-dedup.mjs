/**
 * Cross-project dedup.
 *
 * Phase 3: when policy.scan_global_skill_roots is enabled, scan known
 * filesystem roots (~/.claude/skills, ~/.config/claude/skills, project
 * .claude/skills) and report which candidate slugs already exist
 * elsewhere on the machine. Candidates with a global hit get a
 * `duplicate-already-installed` flag and a sha-mismatch sub-flag if the
 * existing copy differs from the candidate's expected sha256.
 *
 * The scan is read-only and bounded: it only reads top-level SKILL.md
 * files under each root and limits the traversal depth to keep the
 * orchestration fast.
 *
 * Public API:
 *   collectGlobalSkillRoots(projectRoot, { homeDir, extra })
 *     -> string[]
 *   scanGlobalSkills(roots, { fsImpl, maxDepth, maxFiles })
 *     -> Promise<Map<slug, Array<{ path, sha256? }>>>
 *   findDuplicateForCandidate(candidate, scanIndex)
 *     -> { duplicate: boolean, hits: Array, flags: string[] }
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_FILES = 800;

export function collectGlobalSkillRoots(projectRoot, options = {}) {
  const home = options.homeDir ?? os.homedir();
  const roots = [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.config', 'claude', 'skills'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'skills'),
    path.join(projectRoot, '.claude', 'skills'),
  ];
  if (Array.isArray(options.extra)) {
    for (const e of options.extra) roots.push(String(e));
  }
  return [...new Set(roots)];
}

async function safeReaddir(dir, fsImpl) {
  try {
    return await fsImpl.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeReadFile(file, fsImpl) {
  try {
    return await fsImpl.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function frontmatterName(text) {
  if (!text) return null;
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(text);
  if (!match) return null;
  const block = match[1];
  const nameMatch = /^\s*name\s*:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(block);
  return nameMatch ? nameMatch[1].trim() : null;
}

async function scanRoot(root, opts) {
  const fsImpl = opts.fsImpl;
  const maxDepth = opts.maxDepth;
  const remaining = opts.remaining;
  const out = [];
  const queue = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && remaining.value > 0) {
    const { dir, depth } = queue.shift();
    const entries = await safeReaddir(dir, fsImpl);
    for (const entry of entries) {
      if (remaining.value <= 0) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/SKILL\.md$/i.test(entry.name)) continue;
      const text = await safeReadFile(full, fsImpl);
      if (text == null) continue;
      const slug = frontmatterName(text) ?? path.basename(path.dirname(full));
      const sha = `sha256:${createHash('sha256').update(text).digest('hex')}`;
      out.push({ slug: String(slug), path: full, sha256: sha });
      remaining.value -= 1;
    }
  }
  return out;
}

export async function scanGlobalSkills(roots, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const remaining = { value: maxFiles };
  const index = new Map();

  for (const root of roots) {
    if (remaining.value <= 0) break;
    const hits = await scanRoot(root, { fsImpl, maxDepth, remaining });
    for (const hit of hits) {
      if (!index.has(hit.slug)) index.set(hit.slug, []);
      index.get(hit.slug).push({ path: hit.path, sha256: hit.sha256 });
    }
  }
  return index;
}

export function findDuplicateForCandidate(candidate, scanIndex) {
  const flags = [];
  if (!candidate?.slug) return { duplicate: false, hits: [], flags };
  const hits = scanIndex?.get(candidate.slug) ?? [];
  if (hits.length === 0) return { duplicate: false, hits: [], flags };
  flags.push('duplicate-already-installed');
  if (candidate.sha256) {
    const shaMismatch = hits.every((hit) => hit.sha256 && hit.sha256 !== candidate.sha256);
    if (shaMismatch) flags.push('duplicate-sha-mismatch');
  }
  return { duplicate: true, hits, flags };
}

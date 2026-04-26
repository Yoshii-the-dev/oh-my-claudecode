/**
 * Plugin Version Attribution
 *
 * Provides stable version attribution fields for every telemetry envelope.
 * All hashes are sha256 first 16 hex chars (Section 11.6).
 * In-process caching with 30s memoization for omc_config_hash (Section 11.4).
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// In-process caches
// ---------------------------------------------------------------------------

let cachedPluginVersion: string | undefined;
let cachedInstallId: string | undefined;

// omc_config_hash: recomputed on each call but memoized for 30s
let cachedOmcConfigHash: string | undefined;
let omcConfigHashExpiry = 0;

// File-content hashes — cached for process lifetime
const fileHashCache = new Map<string, string>();

const OMC_CONFIG_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256_16(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Public API (Section 11.3)
// ---------------------------------------------------------------------------

/**
 * Returns plugin_version from package.json (cached for process lifetime).
 */
function getPluginVersion(directory: string): string {
  if (cachedPluginVersion !== undefined) return cachedPluginVersion;

  // Walk up from directory to find package.json
  const candidates = [
    join(directory, 'package.json'),
    join(dirname(directory), 'package.json'),
  ];

  // Also try the module directory (for installed packages)
  try {
    const pkgPath = new URL('../../package.json', import.meta.url);
    candidates.push(pkgPath.pathname);
  } catch {
    // Not available in all environments
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (typeof pkg.version === 'string') {
          const v: string = pkg.version;
          cachedPluginVersion = v;
          return v;
        }
      } catch {
        // continue
      }
    }
  }

  cachedPluginVersion = '0.0.0';
  return cachedPluginVersion;
}

/**
 * Returns sha256-16(.claude/settings.json + .claude/omc.jsonc).
 * Memoized for 30 seconds.
 */
function computeOmcConfigHash(directory: string): string {
  const now = Date.now();
  if (cachedOmcConfigHash !== undefined && now < omcConfigHashExpiry) {
    return cachedOmcConfigHash;
  }

  const settingsPath = join(directory, '.claude', 'settings.json');
  const omcJsoncPath = join(directory, '.claude', 'omc.jsonc');

  const settingsContent = readFileSafe(settingsPath);
  const omcContent = readFileSafe(omcJsoncPath);

  const combined = settingsContent + omcContent;
  cachedOmcConfigHash = sha256_16(combined);
  omcConfigHashExpiry = now + OMC_CONFIG_CACHE_TTL_MS;

  return cachedOmcConfigHash;
}

/**
 * Generates and persists a per-install UUID.
 * Returns existing one if already present. Mode 0600.
 */
export function getOrCreateInstallId(directory: string): string {
  if (cachedInstallId !== undefined) return cachedInstallId;

  const telemetryDir = join(directory, '.omc', 'telemetry');
  const idPath = join(telemetryDir, '.install-id');

  if (existsSync(idPath)) {
    try {
      const content = readFileSync(idPath, 'utf-8').trim();
      if (content.length > 0) {
        cachedInstallId = content;
        return cachedInstallId;
      }
    } catch {
      // Fall through to create new
    }
  }

  // Create new anonymous UUID
  const newId = randomUUID();
  try {
    mkdirSync(telemetryDir, { recursive: true });
    writeFileSync(idPath, newId, { mode: 0o600 });
  } catch {
    // Silently fail — use in-memory only
  }

  cachedInstallId = newId;
  return cachedInstallId;
}

/**
 * Returns { plugin_version, omc_config_hash, install_id }.
 * Cached for the process lifetime (omc_config_hash: 30s memoization).
 */
export function getBaseAttribution(directory: string): {
  plugin_version: string;
  omc_config_hash: string;
  install_id: string;
} {
  return {
    plugin_version: getPluginVersion(directory),
    omc_config_hash: computeOmcConfigHash(directory),
    install_id: getOrCreateInstallId(directory),
  };
}

/**
 * Returns sha256-16 of agents/<agentType>.md, or undefined if not found. Cached.
 */
export function getAgentPromptHash(directory: string, agentType: string): string | undefined {
  const cacheKey = `agent:${directory}:${agentType}`;
  if (fileHashCache.has(cacheKey)) return fileHashCache.get(cacheKey);

  // Normalize agent type: strip "oh-my-claudecode:" prefix
  const normalized = agentType.replace(/^oh-my-claudecode:/, '');
  const agentPath = join(directory, 'agents', `${normalized}.md`);

  if (!existsSync(agentPath)) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const content = readFileSafe(agentPath);
  if (!content) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const hash = sha256_16(content);
  fileHashCache.set(cacheKey, hash);
  return hash;
}

/**
 * Returns sha256-16 of skills/<slug>/SKILL.md, or undefined if not found. Cached.
 */
export function getSkillContentHash(directory: string, slug: string): string | undefined {
  const cacheKey = `skill:${directory}:${slug}`;
  if (fileHashCache.has(cacheKey)) return fileHashCache.get(cacheKey);

  const skillPath = join(directory, 'skills', slug, 'SKILL.md');

  if (!existsSync(skillPath)) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const content = readFileSafe(skillPath);
  if (!content) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const hash = sha256_16(content);
  fileHashCache.set(cacheKey, hash);
  return hash;
}

/**
 * Returns sha256-16 of src/hooks/<name>/index.ts, or undefined if not found. Cached.
 */
export function getHookVersionHash(directory: string, hookName: string): string | undefined {
  const cacheKey = `hook:${directory}:${hookName}`;
  if (fileHashCache.has(cacheKey)) return fileHashCache.get(cacheKey);

  const hookPath = join(directory, 'src', 'hooks', hookName, 'index.ts');

  if (!existsSync(hookPath)) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const content = readFileSafe(hookPath);
  if (!content) {
    fileHashCache.set(cacheKey, '');
    return undefined;
  }

  const hash = sha256_16(content);
  fileHashCache.set(cacheKey, hash);
  return hash;
}

/**
 * Reset in-process caches (for testing only).
 * @internal
 */
export function resetAttributionCaches(): void {
  cachedPluginVersion = undefined;
  cachedInstallId = undefined;
  cachedOmcConfigHash = undefined;
  omcConfigHashExpiry = 0;
  fileHashCache.clear();
}

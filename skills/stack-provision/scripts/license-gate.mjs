/**
 * License gate with SPDX-aware matching.
 *
 * Phase 3: replaces the binary `no-conflict | conflict | unknown` shape that
 * provision.mjs derives from a regex over license strings. This gate reads a
 * project policy at `.omc/license.json` and decides per candidate whether
 * its license is acceptable. The policy file shape:
 *
 *   {
 *     "project_spdx": "MIT",
 *     "allow": ["MIT","Apache-2.0","BSD-3-Clause","BSD-2-Clause","ISC"],
 *     "deny":  ["AGPL-3.0","SSPL-1.0","Commons Clause"],
 *     "require_known": true,
 *     "treat_unknown_as": "warn"
 *   }
 *
 * If `treat_unknown_as` is `deny` and the candidate license is unknown, it
 * gets rejected; the default is `warn` (manual review) which preserves the
 * Phase 1/2 behaviour.
 *
 * Public API:
 *   loadLicensePolicy(projectRoot, { fsImpl })
 *     -> Promise<{ source, project_spdx, allow, deny, treat_unknown_as }>
 *   resolveLicense(candidate, policy)
 *     -> { decision: 'allow'|'warn'|'deny', spdx, reason, flags: string[] }
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_POLICY = Object.freeze({
  project_spdx: null,
  allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'CC-BY-4.0', '0BSD', 'Unlicense'],
  deny: ['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'Commons-Clause', 'BUSL-1.1', 'EPL-2.0'],
  require_known: false,
  treat_unknown_as: 'warn',
});

const SPDX_ALIASES = new Map([
  ['mit', 'MIT'],
  ['apache', 'Apache-2.0'],
  ['apache 2', 'Apache-2.0'],
  ['apache-2', 'Apache-2.0'],
  ['apache-2.0', 'Apache-2.0'],
  ['apache 2.0', 'Apache-2.0'],
  ['apache license', 'Apache-2.0'],
  ['apache license 2.0', 'Apache-2.0'],
  ['bsd', 'BSD-3-Clause'],
  ['bsd 3', 'BSD-3-Clause'],
  ['bsd-3', 'BSD-3-Clause'],
  ['bsd 3-clause', 'BSD-3-Clause'],
  ['bsd-3-clause', 'BSD-3-Clause'],
  ['bsd 2-clause', 'BSD-2-Clause'],
  ['bsd-2-clause', 'BSD-2-Clause'],
  ['isc', 'ISC'],
  ['cc by 4', 'CC-BY-4.0'],
  ['cc-by-4.0', 'CC-BY-4.0'],
  ['agpl', 'AGPL-3.0'],
  ['agpl-3', 'AGPL-3.0'],
  ['agpl-3.0', 'AGPL-3.0'],
  ['affero', 'AGPL-3.0'],
  ['gpl-3', 'GPL-3.0'],
  ['gpl-3.0', 'GPL-3.0'],
  ['gpl 3', 'GPL-3.0'],
  ['gpl-2', 'GPL-2.0'],
  ['lgpl', 'LGPL-3.0'],
  ['mpl', 'MPL-2.0'],
  ['mpl-2.0', 'MPL-2.0'],
  ['sspl', 'SSPL-1.0'],
  ['sspl-1.0', 'SSPL-1.0'],
  ['busl', 'BUSL-1.1'],
  ['business source license', 'BUSL-1.1'],
  ['epl', 'EPL-2.0'],
  ['epl-2.0', 'EPL-2.0'],
  ['unlicense', 'Unlicense'],
  ['cc0', 'CC0-1.0'],
  ['cc0-1.0', 'CC0-1.0'],
  ['proprietary', 'PROPRIETARY'],
  ['commercial', 'PROPRIETARY'],
  ['non-commercial', 'NC'],
]);

export function normaliseSpdx(raw) {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;
  // Accept SPDX expressions like "MIT OR Apache-2.0" — pick the first token.
  const orMatch = value.split(/\s+OR\s+|\s+AND\s+|\//i)[0];
  if (orMatch) value = orMatch.trim();
  const lowered = value.toLowerCase();
  if (SPDX_ALIASES.has(lowered)) return SPDX_ALIASES.get(lowered);
  // Already a known SPDX-looking token — keep canonical case where safe.
  if (/^[A-Za-z0-9.+-]+$/.test(value)) {
    if (SPDX_ALIASES.has(value.toLowerCase())) return SPDX_ALIASES.get(value.toLowerCase());
    return value;
  }
  return null;
}

export async function loadLicensePolicy(projectRoot, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const target = path.join(projectRoot, '.omc', 'license.json');
  try {
    const raw = await fsImpl.readFile(target, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_POLICY,
      ...parsed,
      project_spdx: normaliseSpdx(parsed.project_spdx) ?? DEFAULT_POLICY.project_spdx,
      allow: Array.isArray(parsed.allow) ? parsed.allow.map((s) => normaliseSpdx(s)).filter(Boolean) : DEFAULT_POLICY.allow,
      deny: Array.isArray(parsed.deny) ? parsed.deny.map((s) => normaliseSpdx(s)).filter(Boolean) : DEFAULT_POLICY.deny,
      _source: target,
    };
  } catch {
    return { ...DEFAULT_POLICY, _source: 'defaults' };
  }
}

export function resolveLicense(candidate, policy = DEFAULT_POLICY) {
  const flags = [];
  const raw = candidate?.license ?? candidate?.license_id ?? candidate?.spdx ?? candidate?.licenseName ?? null;
  const spdx = normaliseSpdx(raw);
  if (!spdx) {
    flags.push('license:unknown');
    const decision = policy.treat_unknown_as === 'deny' ? 'deny' : 'warn';
    if (policy.require_known && decision === 'warn') {
      // require_known forces the unknown license into manual review with a stronger flag.
      flags.push('license:unknown-required');
    }
    return { decision, spdx: null, reason: 'license-unknown', flags };
  }

  const denyList = (policy.deny ?? []).map((s) => normaliseSpdx(s)).filter(Boolean);
  if (denyList.includes(spdx)) {
    flags.push(`license:denied:${spdx}`);
    return { decision: 'deny', spdx, reason: `license-denied:${spdx}`, flags };
  }

  const allowList = (policy.allow ?? []).map((s) => normaliseSpdx(s)).filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(spdx)) {
    flags.push(`license:not-allowed:${spdx}`);
    return { decision: 'warn', spdx, reason: `license-not-allowed:${spdx}`, flags };
  }

  flags.push(`license:allow:${spdx}`);
  return { decision: 'allow', spdx, reason: `license-allow:${spdx}`, flags };
}

export const LICENSE_GATE_DEFAULTS = DEFAULT_POLICY;

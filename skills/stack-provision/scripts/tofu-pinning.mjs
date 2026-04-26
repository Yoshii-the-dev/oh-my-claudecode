/**
 * Trust On First Use (TOFU) pinning.
 *
 * Phase 5: when a skill is installed for the first time, its payload sha256
 * is recorded as the "pinned" hash, and the full SKILL.md is snapshotted on
 * disk. On subsequent revisits, the orchestrator compares the new payload
 * against the pin; if they differ, the candidate is routed to manual review
 * with a unified diff so the operator can judge the change.
 *
 * Storage:
 *   .omc/stack-provision/pins.json
 *     { schema_version: 1, pins: { <slug>: { sha256, snapshot_path,
 *       pinned_at, source } } }
 *   .omc/stack-provision/pins/<slug>.snapshot.md
 *     Full payload content captured at pin time.
 *
 * Public API:
 *   readPinIndex({ projectRoot, fsImpl }) -> index
 *   writePinIndex(index, { projectRoot, fsImpl })
 *   pinSkill({ projectRoot, slug, content, source, now, fsImpl }) -> pin entry
 *   readPinSnapshot({ projectRoot, slug, fsImpl }) -> string|null
 *   checkPinDrift({ projectRoot, slug, content, fsImpl }) ->
 *     { pinned: boolean, drift: boolean, pinned_sha256, current_sha256,
 *       diff_lines?: number, diff?: string }
 *   formatUnifiedDiff(oldText, newText, { contextLines, header })
 *     -> string
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SCHEMA_VERSION = 1;
const DEFAULT_CONTEXT_LINES = 3;
const SNAPSHOT_DIR_NAME = 'pins';

function pinIndexPath(projectRoot) {
  return path.join(projectRoot, '.omc', 'stack-provision', 'pins.json');
}

function snapshotPath(projectRoot, slug) {
  const safe = String(slug).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96) || 'pin';
  return path.join(projectRoot, '.omc', 'stack-provision', SNAPSHOT_DIR_NAME, `${safe}.snapshot.md`);
}

function emptyIndex() {
  return { schema_version: SCHEMA_VERSION, pins: {} };
}

function sha256OfText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export async function readPinIndex(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  try {
    const raw = await fsImpl.readFile(pinIndexPath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.pins) return emptyIndex();
    return {
      schema_version: SCHEMA_VERSION,
      pins: parsed.pins ?? {},
    };
  } catch {
    return emptyIndex();
  }
}

export async function writePinIndex(index, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const target = pinIndexPath(projectRoot);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.writeFile(target, JSON.stringify(index, null, 2), 'utf8');
}

export async function readPinSnapshot(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const target = snapshotPath(projectRoot, options.slug);
  try {
    return await fsImpl.readFile(target, 'utf8');
  } catch {
    return null;
  }
}

export async function pinSkill(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const slug = options.slug;
  const content = String(options.content ?? '');
  if (!slug) throw new Error('pinSkill: slug required');
  const sha = sha256OfText(content);
  const target = snapshotPath(projectRoot, slug);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.writeFile(target, content, 'utf8');
  const index = await readPinIndex({ projectRoot, fsImpl });
  const nowIso = (options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now())).toISOString();
  index.pins[slug] = {
    sha256: sha,
    snapshot_path: path.relative(projectRoot, target),
    pinned_at: nowIso,
    source: options.source ?? 'unknown',
  };
  await writePinIndex(index, { projectRoot, fsImpl });
  return index.pins[slug];
}

export async function checkPinDrift(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const slug = options.slug;
  const content = String(options.content ?? '');
  const currentSha = sha256OfText(content);

  const index = await readPinIndex({ projectRoot, fsImpl });
  const pin = index.pins?.[slug];
  if (!pin) {
    return {
      pinned: false,
      drift: false,
      current_sha256: currentSha,
      pinned_sha256: null,
    };
  }
  if (pin.sha256 === currentSha) {
    return {
      pinned: true,
      drift: false,
      current_sha256: currentSha,
      pinned_sha256: pin.sha256,
    };
  }
  const oldText = (await readPinSnapshot({ projectRoot, slug, fsImpl })) ?? '';
  const diff = formatUnifiedDiff(oldText, content, {
    header: `pinned ${pin.sha256.slice(0, 14)}… → current ${currentSha.slice(0, 14)}…`,
  });
  return {
    pinned: true,
    drift: true,
    current_sha256: currentSha,
    pinned_sha256: pin.sha256,
    pinned_at: pin.pinned_at,
    diff,
    diff_lines: diff.split('\n').length,
    snapshot_path: pin.snapshot_path,
  };
}

/**
 * Minimal unified diff implementation — Myers-ish LCS over line arrays.
 * Sufficient for SKILL.md size (≤ a few thousand lines). Avoids pulling in
 * an external diff library to keep the maintenance lane dependency-free.
 */
function lcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  const table = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

function lcsDiff(aLines, bLines) {
  const table = lcsTable(aLines, bLines);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < aLines.length && j < bLines.length) {
    if (aLines[i] === bLines[j]) {
      ops.push({ kind: 'eq', text: aLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'del', text: aLines[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: bLines[j] });
      j += 1;
    }
  }
  while (i < aLines.length) {
    ops.push({ kind: 'del', text: aLines[i] });
    i += 1;
  }
  while (j < bLines.length) {
    ops.push({ kind: 'add', text: bLines[j] });
    j += 1;
  }
  return ops;
}

export function formatUnifiedDiff(oldText, newText, options = {}) {
  const contextLines = Number.isFinite(options.contextLines)
    ? Math.max(0, options.contextLines)
    : DEFAULT_CONTEXT_LINES;
  const oldLines = String(oldText ?? '').split(/\r?\n/);
  const newLines = String(newText ?? '').split(/\r?\n/);
  const ops = lcsDiff(oldLines, newLines);

  const lines = [];
  if (options.header) lines.push(`# ${options.header}`);
  lines.push('--- pinned');
  lines.push('+++ current');

  // Walk ops; emit hunks around runs of changes with `contextLines` of equal
  // surrounding context. Tracks line numbers in old/new.
  let oldLine = 1;
  let newLine = 1;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === 'eq') {
      oldLine += 1;
      newLine += 1;
      i += 1;
      continue;
    }
    // Found change; collect the hunk.
    const hunkStartOld = Math.max(1, oldLine - contextLines);
    const hunkStartNew = Math.max(1, newLine - contextLines);
    const ctxStart = Math.max(0, i - findEqRunBack(ops, i, contextLines));
    const hunkLines = [];
    for (let k = ctxStart; k < i; k += 1) {
      hunkLines.push(` ${ops[k].text}`);
    }
    let oldCount = i - ctxStart;
    let newCount = i - ctxStart;
    while (i < ops.length) {
      const op = ops[i];
      if (op.kind === 'eq') {
        // peek forward for end-of-hunk
        let eqRun = 0;
        let j = i;
        while (j < ops.length && ops[j].kind === 'eq' && eqRun < contextLines * 2) {
          eqRun += 1;
          j += 1;
        }
        if (eqRun >= contextLines || j === ops.length) {
          // emit `contextLines` of trailing context, then close hunk
          for (let k = 0; k < contextLines && i + k < ops.length && ops[i + k].kind === 'eq'; k += 1) {
            hunkLines.push(` ${ops[i + k].text}`);
            oldCount += 1;
            newCount += 1;
          }
          i += Math.min(contextLines, ops.length - i);
          break;
        }
        for (let k = 0; k < eqRun; k += 1) {
          hunkLines.push(` ${ops[i + k].text}`);
          oldCount += 1;
          newCount += 1;
        }
        i += eqRun;
        continue;
      }
      if (op.kind === 'del') {
        hunkLines.push(`-${op.text}`);
        oldCount += 1;
      } else {
        hunkLines.push(`+${op.text}`);
        newCount += 1;
      }
      i += 1;
    }
    lines.push(`@@ -${hunkStartOld},${oldCount} +${hunkStartNew},${newCount} @@`);
    lines.push(...hunkLines);
    // Advance line counters past the just-emitted hunk.
    for (const hl of hunkLines) {
      if (hl.startsWith('+')) newLine += 1;
      else if (hl.startsWith('-')) oldLine += 1;
      else { oldLine += 1; newLine += 1; }
    }
  }
  return lines.join('\n');
}

function findEqRunBack(ops, idx, max) {
  let run = 0;
  let i = idx - 1;
  while (i >= 0 && ops[i].kind === 'eq' && run < max) {
    run += 1;
    i -= 1;
  }
  return run;
}

export const TOFU_DEFAULTS = Object.freeze({
  SCHEMA_VERSION,
  DEFAULT_CONTEXT_LINES,
});

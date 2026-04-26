/**
 * Generated-draft edit flow.
 *
 * Phase 2: when policy.forbid_generated_drafts blocks a candidate from
 * auto-approval, we still want to give the operator a single, low-friction
 * way to inspect, edit, and re-submit the draft. This module owns:
 *
 *   1. Persisting the proposed content to a stable on-disk path.
 *   2. Embedding a manual-review marker the operator must remove before
 *      the draft is considered "edited".
 *   3. Verifying on apply that the content has actually changed and the
 *      marker is gone — otherwise the draft is rejected.
 *
 * Drafts live under `<projectRoot>/.omc/stack-provision/drafts/` so they
 * persist across plan/apply boundaries and are easy to find by the user.
 *
 * Public API:
 *   stageGeneratedDraft({ projectRoot, candidate, content })
 *     -> Promise<{ path, original_sha256, marker }>
 *
 *   evaluateEditedDraft({ path, originalSha256, marker })
 *     -> Promise<{ ok, reason, current_sha256 }>
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_MARKER = '<!-- omc:stack-provision review-required: remove this line after editing -->';

function sha256Hex(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function draftDir(projectRoot) {
  return path.join(projectRoot, '.omc', 'stack-provision', 'drafts');
}

function draftFilename(candidate) {
  const safe = String(candidate.candidate_id ?? candidate.slug ?? 'draft')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 96);
  const ext = path.extname(candidate.install?.target ?? candidate.install_target ?? '') || '.md';
  return `${safe}${ext}`;
}

function buildHeader(candidate) {
  const lines = [
    DEFAULT_MARKER,
    `<!-- candidate_id: ${candidate.candidate_id ?? 'unknown'} -->`,
    `<!-- source: ${candidate.source ?? 'unknown'} -->`,
  ];
  if (candidate.covered_surface?.length) {
    lines.push(`<!-- surfaces: ${candidate.covered_surface.join(',')} -->`);
  }
  if (candidate.covered_technology?.length) {
    lines.push(`<!-- technologies: ${candidate.covered_technology.join(',')} -->`);
  }
  return lines.join('\n');
}

export async function stageGeneratedDraft({ projectRoot, candidate, content, marker = DEFAULT_MARKER, fsImpl = fs }) {
  if (!projectRoot) throw new Error('stageGeneratedDraft: projectRoot required');
  if (!candidate) throw new Error('stageGeneratedDraft: candidate required');
  const dir = draftDir(projectRoot);
  await fsImpl.mkdir(dir, { recursive: true });

  const filename = draftFilename(candidate);
  const target = path.join(dir, filename);

  const baseContent = typeof content === 'string' && content.length > 0
    ? content
    : (candidate.preview ?? `# ${candidate.title ?? candidate.slug ?? 'Draft skill'}\n\n_Edit me before approving._\n`);

  const header = buildHeader(candidate);
  const composed = `${header}\n\n${baseContent.trim()}\n`;
  await fsImpl.writeFile(target, composed, 'utf8');

  return {
    path: target,
    original_sha256: sha256Hex(composed),
    marker,
  };
}

export async function evaluateEditedDraft({ path: target, originalSha256, marker = DEFAULT_MARKER, fsImpl = fs }) {
  if (!target) throw new Error('evaluateEditedDraft: path required');
  let raw;
  try {
    raw = await fsImpl.readFile(target, 'utf8');
  } catch (err) {
    return { ok: false, reason: `draft missing or unreadable: ${err.message ?? err}`, current_sha256: null };
  }
  const current = sha256Hex(raw);
  if (originalSha256 && current === originalSha256) {
    return { ok: false, reason: 'draft unchanged', current_sha256: current };
  }
  if (raw.includes(marker)) {
    return { ok: false, reason: 'review marker still present', current_sha256: current };
  }
  if (raw.trim().length === 0) {
    return { ok: false, reason: 'draft is empty', current_sha256: current };
  }
  return { ok: true, reason: 'edited', current_sha256: current };
}

export const EDIT_FLOW_MARKER = DEFAULT_MARKER;

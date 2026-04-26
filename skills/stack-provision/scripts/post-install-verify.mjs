/**
 * Post-install hash verification.
 *
 * After `provision promote` copies / triggers installs, this module walks
 * the resulting manifest and checks the actual on-disk artefacts against
 * the recorded `expected_sha256` (where present). Any drift is reported
 * back to the orchestrator as a finding; critical drift produces a
 * rollback marker that the user-facing layer can surface.
 *
 * The verifier is intentionally read-only: it never deletes installed
 * skills. Rolling back is a separate explicit step (`provision rollback`).
 *
 * Public API:
 *   verifyManifestArtefacts(manifest, { projectRoot, fsImpl })
 *     -> Promise<{ verified: boolean, findings: Array<…>, drift_count }>
 *
 * Manifest entry shape (subset of manifest.schema.json):
 *   { candidate_id, action, install_target, expected_sha256?, install_kind }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function sha256OfBuffer(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

function normaliseAction(action) {
  return String(action ?? '').toLowerCase();
}

function shouldVerifyEntry(entry) {
  const action = normaliseAction(entry.action ?? entry.status);
  if (action.startsWith('skip') || action.startsWith('reject') || action.startsWith('quarantine')) {
    return false;
  }
  if (!entry.install_target) return false;
  return true;
}

async function statSafe(target, fsImpl) {
  try {
    const stat = await fsImpl.stat(target);
    return stat;
  } catch {
    return null;
  }
}

export async function verifyManifestArtefacts(manifest, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const findings = [];
  let driftCount = 0;
  let criticalCount = 0;

  const entries = Array.isArray(manifest?.entries)
    ? manifest.entries
    : Array.isArray(manifest)
      ? manifest
      : [];

  for (const entry of entries) {
    if (!shouldVerifyEntry(entry)) continue;
    const installKind = entry.install_kind ?? entry.install?.kind ?? 'unknown';
    const target = path.isAbsolute(entry.install_target)
      ? entry.install_target
      : path.join(projectRoot, entry.install_target);
    const expected = entry.expected_sha256 ?? entry.install?.expected_sha256 ?? null;

    const stat = await statSafe(target, fsImpl);
    if (!stat) {
      // For copy-skill we expect the file to exist; for plugin-install/external-command
      // it might be a directory or pending action — record but don't escalate.
      const severity = installKind === 'copy-skill' || installKind === 'download-skill' ? 'critical' : 'warn';
      findings.push({
        candidate_id: entry.candidate_id ?? null,
        target,
        kind: installKind,
        status: 'missing',
        severity,
      });
      if (severity === 'critical') criticalCount += 1;
      driftCount += 1;
      continue;
    }

    if (stat.isDirectory()) {
      // Cannot hash directories; record presence only.
      findings.push({
        candidate_id: entry.candidate_id ?? null,
        target,
        kind: installKind,
        status: 'present-directory',
        severity: 'info',
      });
      continue;
    }

    let buf;
    try {
      buf = await fsImpl.readFile(target);
    } catch (err) {
      findings.push({
        candidate_id: entry.candidate_id ?? null,
        target,
        kind: installKind,
        status: 'unreadable',
        severity: 'warn',
        error: err.message ?? String(err),
      });
      driftCount += 1;
      continue;
    }
    const actual = sha256OfBuffer(buf);
    if (!expected) {
      findings.push({
        candidate_id: entry.candidate_id ?? null,
        target,
        kind: installKind,
        status: 'present-no-expected-hash',
        severity: 'info',
        actual_sha256: actual,
      });
      continue;
    }
    if (expected !== actual) {
      findings.push({
        candidate_id: entry.candidate_id ?? null,
        target,
        kind: installKind,
        status: 'hash-drift',
        severity: 'critical',
        expected_sha256: expected,
        actual_sha256: actual,
      });
      driftCount += 1;
      criticalCount += 1;
      continue;
    }
    findings.push({
      candidate_id: entry.candidate_id ?? null,
      target,
      kind: installKind,
      status: 'hash-match',
      severity: 'ok',
      expected_sha256: expected,
      actual_sha256: actual,
    });
  }

  return {
    verified: criticalCount === 0,
    findings,
    drift_count: driftCount,
    critical_count: criticalCount,
    rollback_recommended: criticalCount > 0,
  };
}

export function summariseVerification(report) {
  const counts = { ok: 0, info: 0, warn: 0, critical: 0 };
  for (const f of report.findings ?? []) {
    if (f.severity === 'ok') counts.ok += 1;
    else if (f.severity === 'info') counts.info += 1;
    else if (f.severity === 'warn') counts.warn += 1;
    else if (f.severity === 'critical') counts.critical += 1;
  }
  return {
    verified: report.verified ?? false,
    drift_count: report.drift_count ?? 0,
    critical_count: report.critical_count ?? 0,
    counts,
  };
}

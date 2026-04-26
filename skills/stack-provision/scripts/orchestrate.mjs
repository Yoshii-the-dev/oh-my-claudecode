#!/usr/bin/env node
/**
 * stack-provision orchestrator (Phase 1 facade)
 *
 * Single-entry wrapper that turns the 5-command ceremony
 * (init → discover → review → promote → verify) into a deterministic
 * event-stream: one node process, JSON lines on stdout,
 * decisions on stdin (or policy file in headless mode).
 *
 * No user-visible flags or run-ids: the slash skill / `omc stack` CLI
 * speaks the JSON protocol below; humans see prompts, not commands.
 *
 * STDOUT events (one JSON object per line):
 *   { event: 'phase', name, status: 'started'|'completed'|'failed', ... }
 *   { event: 'detect', source: 'adr'|'stack-list'|'none', path, stack }
 *   { event: 'review_summary', auto_approve, needs_decision, reject }
 *   { event: 'request_decision', candidate }
 *   { event: 'install_plan', approved, skipped, generated_drafts }
 *   { event: 'completed', status, manifest_path, run_dir }
 *   { event: 'error', message, code }
 *
 * STDIN messages (one JSON object per line):
 *   { type: 'decision', candidate_id, action: 'approve'|'skip'|'reject'|'edit' }
 *   { type: 'batch_resolve', remaining: 'approve_safe'|'skip_all' }
 *   { type: 'cancel' }
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { stageGeneratedDraft, evaluateEditedDraft, EDIT_FLOW_MARKER } from './edit-flow.mjs';
import { verifyManifestArtefacts, summariseVerification } from './post-install-verify.mjs';
import { resolveDependencies, buildSkillIndex } from './dependency-graph.mjs';
import { loadLicensePolicy, resolveLicense } from './license-gate.mjs';
import {
  collectGlobalSkillRoots,
  scanGlobalSkills,
  findDuplicateForCandidate,
} from './cross-project-dedup.mjs';
import {
  recordBatch as recordTelemetryBatch,
  TELEMETRY_DEFAULTS,
} from './telemetry.mjs';
import {
  shouldRevalidate,
  revalidateManifest,
  writeRevalidationState,
} from './revalidation.mjs';
import { gatherCveSignals } from './cve-feed.mjs';
import { findCleanupCandidates } from './auto-cleanup.mjs';
import { checkPinDrift, pinSkill } from './tofu-pinning.mjs';
import { dryRunSkill } from './sandbox-dryrun.mjs';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const INIT_SCRIPT = path.join(SCRIPT_DIR, 'init.mjs');
const PROVISION_SCRIPT = path.join(SCRIPT_DIR, 'provision.mjs');

const DEFAULT_POLICY = Object.freeze({
  // Lowered from 0.95 → 0.90 as part of the autonomous-default rollout: trust
  // signals from skills.sh / agentskill-sh top out around 0.92 even for clean
  // entries, so 0.95 effectively forced manual review on almost everything.
  auto_approve_threshold: 0.9,
  blocked_sources: [],
  forbid_generated_drafts: true,
  // Default to autonomous resolution. Headless `bail` was the historical
  // default; in practice it forces the slash-skill to spam A/B/C/D prompts at
  // the user. With `auto_approve_safe` the orchestrator approves candidates
  // that already passed the strict gate and are not critical/generated, and
  // only escalates the genuinely ambiguous ones.
  headless_action: 'auto_approve_safe', // bail | auto_approve_safe | manifest_only
  // Cap on how many per-candidate decisions the slash-skill should ask for in
  // a single session before offering a single batch resolve. Lowered from 25
  // (which the SKILL.md still references for legacy contracts) to 5 so even
  // small stacks (5–10 candidates) get a single batch question instead of N.
  max_decisions_per_session: 5,
  approved_by: 'orchestrator',
  critic_verdict: 'approve',
  skill_root: null, // null = default project-scoped
  // Phase 4 maintenance hooks. All default-on but cheap to disable per project.
  cve_check: true,
  revalidation_enabled: true,
  revalidation_interval_days: 7,
  cleanup_enabled: true,
  cleanup_threshold_days: 60,
  // Phase 5 long-term trust gating.
  tofu_enabled: true,
  tofu_strict: false, // when true, drift = reject (else manual)
  sandbox_dryrun_enabled: true,
  sandbox_max_tools: null, // null disables count gate
});

function emit(event) {
  try {
    process.stdout.write(`${JSON.stringify({ ts: Date.now(), ...event })}\n`);
  } catch (err) {
    // stdout may be closed; nothing to do.
  }
}

function fail(message, code = 1, extra = {}) {
  emit({ event: 'error', message, code, ...extra });
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    stack: null,
    projectRoot: process.cwd(),
    policyPath: null,
    headless: !process.stdin.isTTY,
    decisionsFromStdin: !process.stdin.isTTY,
    autoMode: null, // override policy.headless_action
    noPromote: false,
    skillRoot: null,
    mode: 'full', // full | plan-only | apply
    planFile: null, // for plan-only output / apply input
    decisionsFile: null, // for apply: pre-collected decisions JSONL
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--policy' || a === '--policy-path') opts.policyPath = argv[++i];
    else if (a.startsWith('--policy=')) opts.policyPath = a.slice('--policy='.length);
    else if (a === '--project-root') opts.projectRoot = argv[++i];
    else if (a.startsWith('--project-root=')) opts.projectRoot = a.slice('--project-root='.length);
    else if (a === '--headless') opts.headless = true;
    else if (a === '--interactive') opts.headless = false;
    else if (a === '--decisions-from-stdin') opts.decisionsFromStdin = true;
    else if (a === '--no-decisions-stdin') opts.decisionsFromStdin = false;
    else if (a === '--auto-mode') opts.autoMode = argv[++i];
    else if (a.startsWith('--auto-mode=')) opts.autoMode = a.slice('--auto-mode='.length);
    else if (a === '--no-promote') opts.noPromote = true;
    else if (a === '--skill-root') opts.skillRoot = argv[++i];
    else if (a.startsWith('--skill-root=')) opts.skillRoot = a.slice('--skill-root='.length);
    else if (a === '--plan-only') opts.mode = 'plan-only';
    else if (a === '--apply') opts.mode = 'apply';
    else if (a === '--plan-file') opts.planFile = argv[++i];
    else if (a.startsWith('--plan-file=')) opts.planFile = a.slice('--plan-file='.length);
    else if (a === '--decisions-file') opts.decisionsFile = argv[++i];
    else if (a.startsWith('--decisions-file=')) opts.decisionsFile = a.slice('--decisions-file='.length);
    else if (a.startsWith('--')) {
      // Forward unknown long flags to init.mjs (e.g. --surfaces, --blocks)
      opts[`__forward__${a}`] = argv[++i] && !argv[i].startsWith('--') ? argv[i] : true;
    } else positional.push(a);
  }
  if (positional.length > 0) opts.stack = positional.join(' ');
  return opts;
}

async function readDecisionsFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.type === 'decision' && msg.candidate_id) {
        map.set(msg.candidate_id, { action: msg.action, source: 'decisions-file' });
      } else if (msg.type === 'batch_resolve') {
        map.set('__batch__', { remaining: msg.remaining ?? 'skip_all' });
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return map;
}

async function readPolicy(projectRoot, policyPath) {
  const target = policyPath
    ? path.resolve(projectRoot, policyPath)
    : path.join(projectRoot, '.omc', 'stack-provision-policy.json');
  try {
    const raw = await fs.readFile(target, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_POLICY, ...parsed, _source: target };
  } catch (err) {
    if (policyPath) {
      // Explicit path was provided but unreadable — fail hard.
      throw new Error(`policy file unreadable at ${target}: ${err.message}`);
    }
    return { ...DEFAULT_POLICY, _source: 'defaults' };
  }
}

async function autoDetectAdr(projectRoot) {
  const decisionsDir = path.join(projectRoot, '.omc', 'decisions');
  try {
    const entries = await fs.readdir(decisionsDir);
    const candidates = entries
      .filter((e) => /\.md$/.test(e) && /technology|stack/i.test(e))
      .map((e) => path.join(decisionsDir, e));
    if (candidates.length === 0) return null;
    const stats = await Promise.all(
      candidates.map(async (p) => ({ p, mt: (await fs.stat(p)).mtimeMs }))
    );
    stats.sort((a, b) => b.mt - a.mt);
    return stats[0].p;
  } catch {
    return null;
  }
}

function spawnJson(script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      let parsed = null;
      let parseError = null;
      if (stdout) {
        try {
          parsed = JSON.parse(stdout);
        } catch (err) {
          parseError = String(err.message ?? err);
        }
      }
      if (code !== 0) {
        const msg = parsed?.error || parseError || stderr || `exit code ${code}`;
        const err = new Error(`${path.basename(script)}: ${msg}`);
        err.exitCode = code;
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      if (parseError) return reject(new Error(`${path.basename(script)}: invalid JSON output (${parseError})`));
      resolve({ parsed, stdout, stderr });
    });
  });
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function stageDraftsForGenerated({ candidates, candidatesById, needsDecision, projectRoot }) {
  const staged = [];
  for (const id of needsDecision) {
    const c = candidatesById.get(id);
    if (!c) continue;
    const verdict = c.__verdict ?? {};
    const isGeneratedDraft =
      c.source === 'generated' ||
      String(c.action_type ?? '').includes('generated') ||
      /generated-draft/i.test(String(verdict.reason ?? ''));
    if (!isGeneratedDraft) continue;
    try {
      const result = await stageGeneratedDraft({
        projectRoot,
        candidate: c,
        content: c.preview ?? c.draft_content ?? null,
      });
      c.__draft = {
        path: result.path,
        original_sha256: result.original_sha256,
        marker: result.marker,
      };
      staged.push({ candidate_id: id, path: result.path });
    } catch (err) {
      c.__draft = { error: err.message ?? String(err) };
    }
  }
  return staged;
}

async function resolveDraftEdits({ ids, candidatesById }) {
  const results = new Map();
  for (const id of ids) {
    const c = candidatesById.get(id);
    if (!c) {
      results.set(id, { ok: false, reason: 'candidate not found' });
      continue;
    }
    const draft = c.__draft ?? c.draft;
    if (!draft || !draft.path) {
      results.set(id, { ok: false, reason: 'draft was not staged for this candidate' });
      continue;
    }
    try {
      const evalResult = await evaluateEditedDraft({
        path: draft.path,
        originalSha256: draft.original_sha256,
        marker: draft.marker ?? EDIT_FLOW_MARKER,
      });
      results.set(id, evalResult);
    } catch (err) {
      results.set(id, { ok: false, reason: `evaluation failed: ${err.message ?? err}` });
    }
  }
  return results;
}

async function maybeOpportunisticRevalidation({ projectRoot, policy }) {
  if (policy.revalidation_enabled === false) return null;
  try {
    const stale = await shouldRevalidate({
      projectRoot,
      intervalDays: policy.revalidation_interval_days,
    });
    if (!stale) return null;
    const currentPath = path.join(projectRoot, '.omc', 'provisioned', 'current.json');
    let manifest = null;
    try {
      manifest = JSON.parse(await fs.readFile(currentPath, 'utf8'));
    } catch {
      return { ok: false, reason: 'no-current-manifest' };
    }
    const report = await revalidateManifest({
      manifest,
      projectRoot,
      intervalDays: policy.revalidation_interval_days,
      fetchImpl: policy.offline ? null : globalThis.fetch,
    });
    await writeRevalidationState(report, { projectRoot });
    emit({
      event: 'revalidation',
      total: report.summary.total,
      local_drift: report.summary.local_drift,
      upstream_drift: report.summary.upstream_drift,
      checked_at: report.last_check_at,
    });
    return { ok: true, report };
  } catch (err) {
    emit({ event: 'revalidation', error: err.message ?? String(err) });
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function maybeCleanupProposal({ projectRoot, policy }) {
  if (policy.cleanup_enabled === false) return null;
  try {
    const proposal = await findCleanupCandidates({
      projectRoot,
      thresholdDays: policy.cleanup_threshold_days,
    });
    if (proposal.suggestion === 'noop') return proposal;
    emit({
      event: 'cleanup_proposal',
      threshold_days: proposal.summary.threshold_days,
      idle_count: proposal.summary.idle_count,
      candidates: proposal.candidates.map((c) => ({
        slug: c.slug,
        idle_days: c.idle_days,
        last_used_at: c.last_used_at,
        install_target: c.install_target,
      })),
    });
    return proposal;
  } catch (err) {
    emit({ event: 'cleanup_proposal', error: err.message ?? String(err) });
    return null;
  }
}

async function annotateCveFlags({ candidates, policy }) {
  if (policy.cve_check === false) return { fetched: 0, flagged: 0 };
  const cache = new Map();
  let fetched = 0;
  let flagged = 0;
  for (const c of candidates) {
    try {
      const signals = await gatherCveSignals(c, {
        fetchImpl: policy.offline ? null : globalThis.fetch,
        network: policy.offline !== true,
        cache,
      });
      fetched += signals.fetched;
      if (signals.flags.length > 0) {
        c.risk_flags = [...new Set([...(c.risk_flags ?? []), ...signals.flags])];
        c.cve_signals = {
          advisories: signals.advisories,
          severity: signals.severity,
          degraded: signals.degraded,
        };
        flagged += 1;
      }
    } catch {
      // Never block classify on CVE feed errors.
    }
  }
  if (fetched > 0 || flagged > 0) {
    emit({ event: 'cve_scan', fetched, flagged });
  }
  return { fetched, flagged };
}

async function annotateTofuDrift({ candidates, projectRoot, policy }) {
  if (policy.tofu_enabled === false) return { drift: 0, pinned: 0 };
  let drift = 0;
  let pinned = 0;
  for (const c of candidates) {
    const slug = c.slug ?? c.candidate_id;
    const content = c.preview ?? c.draft_content ?? null;
    if (!slug || typeof content !== 'string' || content.length === 0) continue;
    try {
      const pinCheck = await checkPinDrift({ projectRoot, slug, content });
      if (!pinCheck.pinned) continue;
      pinned += 1;
      if (pinCheck.drift) {
        drift += 1;
        c.tofu_drift = {
          pinned_sha256: pinCheck.pinned_sha256,
          current_sha256: pinCheck.current_sha256,
          pinned_at: pinCheck.pinned_at,
          diff_lines: pinCheck.diff_lines,
          diff: pinCheck.diff,
          snapshot_path: pinCheck.snapshot_path,
        };
        const flag = policy.tofu_strict ? 'tofu:drift:critical' : 'tofu:drift:warn';
        c.risk_flags = [...new Set([...(c.risk_flags ?? []), flag])];
      }
    } catch {
      // TOFU never blocks classify on storage errors.
    }
  }
  if (pinned > 0 || drift > 0) {
    emit({ event: 'tofu_check', pinned, drift });
  }
  return { drift, pinned };
}

function annotateSandboxFingerprints({ candidates, policy }) {
  if (policy.sandbox_dryrun_enabled === false) return { critical: 0, warned: 0 };
  let critical = 0;
  let warned = 0;
  for (const c of candidates) {
    const content = c.preview ?? c.draft_content ?? null;
    if (typeof content !== 'string' || content.length === 0) continue;
    try {
      const result = dryRunSkill({
        content,
        policy: { sandbox_max_tools: policy.sandbox_max_tools },
      });
      c.sandbox_dryrun = {
        severity: result.severity,
        fingerprint: result.fingerprint,
        findings: result.findings,
      };
      if (result.flags.length > 0) {
        c.risk_flags = [...new Set([...(c.risk_flags ?? []), ...result.flags])];
      }
      if (result.severity === 'critical') critical += 1;
      else if (result.severity === 'warn') warned += 1;
    } catch {
      // never block classify on parse failures
    }
  }
  if (critical > 0 || warned > 0) {
    emit({ event: 'sandbox_dryrun', critical, warned });
  }
  return { critical, warned };
}

async function pinApprovedSkills({ approved, candidatesById, projectRoot, policy }) {
  if (policy.tofu_enabled === false) return { pinned: 0 };
  let count = 0;
  for (const id of approved) {
    const c = candidatesById.get(id);
    if (!c) continue;
    const slug = c.slug ?? c.candidate_id;
    const content = c.preview ?? c.draft_content ?? null;
    if (!slug || typeof content !== 'string' || content.length === 0) continue;
    try {
      await pinSkill({
        projectRoot,
        slug,
        content,
        source: c.source ?? 'orchestrate',
      });
      count += 1;
    } catch {
      // ignore — pinning failure must not break promote.
    }
  }
  if (count > 0) emit({ event: 'tofu_pinned', count });
  return { pinned: count };
}

async function persistTelemetryForApproved({ approved, candidatesById, projectRoot }) {
  const slugs = approved
    .map((id) => candidatesById.get(id)?.slug ?? id)
    .filter((s) => typeof s === 'string' && s);
  if (slugs.length === 0) return;
  try {
    await recordTelemetryBatch(slugs, { projectRoot, kind: 'install' });
    emit({ event: 'telemetry_recorded', slug_count: slugs.length });
  } catch (err) {
    emit({ event: 'telemetry_recorded', error: err.message ?? String(err) });
  }
}

async function attemptAutoRollback({ runDir, projectRoot }) {
  emit({ event: 'rollback', status: 'started', reason: 'critical hash drift' });
  try {
    const res = await spawnJson(PROVISION_SCRIPT, ['rollback', runDir, '--json'], {
      cwd: projectRoot,
    });
    emit({
      event: 'rollback',
      status: 'completed',
      reverted: res.parsed?.reverted ?? null,
      manifest_path: res.parsed?.manifest_path ?? null,
    });
    return { ok: true, parsed: res.parsed ?? null };
  } catch (err) {
    emit({
      event: 'rollback',
      status: 'failed',
      message: err.message ?? String(err),
      stderr: err.stderr,
    });
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function runPostInstallVerify({ runDir, projectRoot }) {
  try {
    const manifestPath = path.join(runDir, 'manifest.json');
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const installed = Array.isArray(manifest.installed) ? manifest.installed : [];
    const entries = installed.map((i) => ({
      candidate_id: i.candidate_id ?? null,
      install_target: i.target_path ?? i.install_target ?? null,
      install_kind: i.install_kind ?? 'copy-skill',
      expected_sha256: i.sha256 ?? i.expected_sha256 ?? null,
    }));
    const report = await verifyManifestArtefacts({ entries }, { projectRoot });
    return { ok: true, report, summary: summariseVerification(report) };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

function classifyCandidate(candidate, policy, ctx = {}) {
  const trust = Number(candidate.source_trust ?? 0);
  const risks = candidate.risk_flags ?? [];
  const source = candidate.source ?? 'unknown';
  const isGenerated =
    source === 'generated' || (candidate.action_type ?? '').includes('generated');

  if ((policy.blocked_sources ?? []).includes(source)) {
    return { decision: 'reject', reason: `source '${source}' blocked by policy` };
  }

  // Phase 3: license-gate is a hard reject when SPDX is on deny list.
  if (ctx.licensePolicy) {
    const licenseVerdict = resolveLicense(candidate, ctx.licensePolicy);
    candidate.__license = licenseVerdict;
    if (licenseVerdict.decision === 'deny') {
      return {
        decision: 'reject',
        reason: `license-blocked: ${licenseVerdict.reason}`,
        license: licenseVerdict,
      };
    }
    if (licenseVerdict.decision === 'warn') {
      return {
        decision: 'manual',
        reason: `license requires manual review: ${licenseVerdict.reason}`,
        license: licenseVerdict,
      };
    }
  }

  // Phase 3: cross-project dedup — duplicates land in manual review.
  if (ctx.dedupIndex) {
    const dup = findDuplicateForCandidate(candidate, ctx.dedupIndex);
    if (dup.duplicate) {
      candidate.__duplicate = dup;
      const flagSet = new Set([...(candidate.risk_flags ?? []), ...dup.flags]);
      candidate.risk_flags = [...flagSet];
      return {
        decision: 'manual',
        reason: dup.flags.includes('duplicate-sha-mismatch')
          ? 'duplicate already installed elsewhere with different content'
          : 'duplicate already installed elsewhere',
        duplicate: dup,
      };
    }
  }

  if (isGenerated && policy.forbid_generated_drafts) {
    return { decision: 'manual', reason: 'generated-draft must be edited before approval' };
  }
  const hasCritical = risks.some((flag) => /critical/i.test(String(flag)));
  if (hasCritical) {
    return { decision: 'manual', reason: 'critical risk flag set' };
  }
  const hasWarning = risks.some((flag) => /warn/i.test(String(flag)));
  const passesGate = candidate.strict_gate?.passed !== false;
  if (
    !hasWarning &&
    passesGate &&
    trust >= (policy.auto_approve_threshold ?? DEFAULT_POLICY.auto_approve_threshold)
  ) {
    return {
      decision: 'auto-approve',
      reason: `trust ${trust.toFixed(2)} ≥ ${(policy.auto_approve_threshold ?? 0.95).toFixed(2)} & no warnings`,
    };
  }
  if (!passesGate) return { decision: 'manual', reason: 'strict-gate not passed' };
  if (hasWarning) return { decision: 'manual', reason: 'warning risk flag' };
  return {
    decision: 'manual',
    reason: `trust ${trust.toFixed(2)} below threshold ${(policy.auto_approve_threshold ?? 0.95).toFixed(2)}`,
  };
}

function readStdinDecisions(neededIds) {
  if (neededIds.size === 0) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    const collected = new Map();
    const pending = new Set(neededIds);
    const rl = createInterface({ input: process.stdin });
    let cancelled = false;
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'cancel') {
        cancelled = true;
        rl.close();
        return;
      }
      if (msg.type === 'batch_resolve') {
        const action = msg.remaining === 'approve_safe' ? 'approve' : 'skip';
        for (const id of pending) {
          collected.set(id, { action, source: 'batch_resolve' });
        }
        pending.clear();
        rl.close();
        return;
      }
      if (msg.type === 'decision' && msg.candidate_id && pending.has(msg.candidate_id)) {
        collected.set(msg.candidate_id, { action: msg.action, source: 'decision' });
        pending.delete(msg.candidate_id);
        if (pending.size === 0) rl.close();
      }
    });
    rl.on('close', () => {
      resolve({ decisions: collected, cancelled, unresolved: pending });
    });
  });
}

async function applyHeadlessPolicy(neededIds, candidatesById, policy) {
  const decisions = new Map();
  const action = policy._effective_headless ?? policy.headless_action ?? 'bail';
  if (action === 'bail') {
    return {
      decisions,
      cancelled: true,
      bailed: true,
      reason: `policy.headless_action=bail and ${neededIds.size} candidate(s) require manual decision`,
    };
  }
  for (const id of neededIds) {
    const candidate = candidatesById.get(id);
    if (!candidate) {
      decisions.set(id, { action: 'skip', source: 'headless-missing' });
      continue;
    }
    if (action === 'auto_approve_safe') {
      const passesGate = candidate.strict_gate?.passed !== false;
      const hasCritical = (candidate.risk_flags ?? []).some((f) => /critical/i.test(String(f)));
      const isGenerated = candidate.source === 'generated';
      if (passesGate && !hasCritical && !isGenerated) {
        decisions.set(id, { action: 'approve', source: 'headless-safe' });
      } else {
        decisions.set(id, { action: 'skip', source: 'headless-unsafe' });
      }
    } else {
      // manifest_only and unknown values → skip everything not auto-approved.
      decisions.set(id, { action: 'skip', source: 'headless-conservative' });
    }
  }
  return { decisions, cancelled: false, bailed: false };
}

async function runOrchestration(opts) {
  const policy = await readPolicy(opts.projectRoot, opts.policyPath);
  if (opts.autoMode) policy._effective_headless = opts.autoMode;
  if (opts.skillRoot) policy.skill_root = opts.skillRoot;

  if (opts.mode === 'apply') {
    if (!opts.planFile) fail('--apply requires --plan-file=<path>', 2);
    let plan;
    try {
      plan = await readJsonFile(opts.planFile);
    } catch (err) {
      fail(`could not read plan file: ${err.message}`, 2);
    }
    return runApplyFromPlan({ ...opts, plan, policy });
  }

  // Phase 4: opportunistic maintenance — runs once per orchestration before
  // any new work, never blocks the main flow.
  await maybeOpportunisticRevalidation({ projectRoot: opts.projectRoot, policy });
  await maybeCleanupProposal({ projectRoot: opts.projectRoot, policy });

  emit({ event: 'phase', name: 'detect', status: 'started' });
  let stackArg = opts.stack;
  let detectedAdr = null;
  if (!stackArg) {
    detectedAdr = await autoDetectAdr(opts.projectRoot);
    if (detectedAdr) stackArg = detectedAdr;
  }
  if (!stackArg) {
    emit({ event: 'detect', source: 'none', path: null, stack: null });
    fail('no stack source: provide stack list or place a technology ADR under .omc/decisions/', 2);
  }
  emit({
    event: 'detect',
    source: detectedAdr ? 'adr' : 'stack-list',
    path: detectedAdr,
    stack: detectedAdr ? null : stackArg,
  });

  emit({ event: 'phase', name: 'init', status: 'started' });
  const initArgs = [stackArg, '--json'];
  for (const [k, v] of Object.entries(opts).filter(([k]) => k.startsWith('__forward__'))) {
    initArgs.push(k.replace('__forward__', ''));
    if (v !== true) initArgs.push(String(v));
  }
  let initRes;
  try {
    initRes = await spawnJson(INIT_SCRIPT, initArgs, { cwd: opts.projectRoot });
  } catch (err) {
    fail(`init failed: ${err.message}`, 3, { stderr: err.stderr });
  }
  const runDir = initRes.parsed?.artifacts?.run_dir ?? initRes.parsed?.run_dir;
  const runId = initRes.parsed?.run_id;
  if (!runDir) fail('init did not return artifacts.run_dir', 3, { init_output: initRes.parsed });
  emit({ event: 'phase', name: 'init', status: 'completed', run_dir: runDir, run_id: runId });

  emit({ event: 'phase', name: 'discovery', status: 'started' });
  let discoverRes;
  try {
    discoverRes = await spawnJson(PROVISION_SCRIPT, ['discover', runDir, '--json'], {
      cwd: opts.projectRoot,
    });
  } catch (err) {
    fail(`discovery failed: ${err.message}`, 4, { stderr: err.stderr });
  }
  // discover returns a count; full candidate list is on disk.
  const candidatesPath =
    discoverRes.parsed?.artifacts?.candidates ?? path.join(runDir, 'candidates.json');
  let candidatesFile;
  try {
    candidatesFile = await readJsonFile(candidatesPath);
  } catch (err) {
    fail(`could not read candidates.json: ${err.message}`, 4);
  }
  const candidates = Array.isArray(candidatesFile?.candidates)
    ? candidatesFile.candidates
    : Array.isArray(candidatesFile)
      ? candidatesFile
      : [];
  emit({
    event: 'phase',
    name: 'discovery',
    status: 'completed',
    candidate_count: candidates.length,
    coverage_summary: discoverRes.parsed?.coverage_summary ?? null,
  });

  // Phase 4: CVE feed — must run before classify so risk_flags include
  // cve:* tokens that the policy and gate already understand.
  await annotateCveFlags({ candidates, policy });

  // Phase 5: TOFU pinning + sandbox dry-run also run before classify so
  // tofu:drift:* and sandbox:* flags route candidates to manual review.
  await annotateTofuDrift({ candidates, projectRoot: opts.projectRoot, policy });
  annotateSandboxFingerprints({ candidates, policy });

  // Phase 3: classify context — license policy + optional cross-project dedup.
  const licensePolicy = await loadLicensePolicy(opts.projectRoot);
  let dedupIndex = null;
  if (policy.scan_global_skill_roots) {
    try {
      const roots = collectGlobalSkillRoots(opts.projectRoot);
      dedupIndex = await scanGlobalSkills(roots);
      emit({
        event: 'dedup_scan',
        roots: roots.length,
        slugs: dedupIndex.size,
      });
    } catch (err) {
      emit({ event: 'dedup_scan', error: err.message ?? String(err) });
      dedupIndex = null;
    }
  }
  const classifyCtx = { licensePolicy, dedupIndex };

  // Classify every candidate by policy.
  const candidatesById = new Map();
  const autoApprove = [];
  const needsDecision = [];
  const rejected = [];
  for (const c of candidates) {
    candidatesById.set(c.candidate_id, c);
    const verdict = classifyCandidate(c, policy, classifyCtx);
    c.__verdict = verdict;
    if (verdict.decision === 'auto-approve') autoApprove.push(c.candidate_id);
    else if (verdict.decision === 'reject') rejected.push(c.candidate_id);
    else needsDecision.push(c.candidate_id);
  }

  // Phase 3: dependency closure — pull peers of auto-approved candidates that
  // are themselves classifiable as auto-approve. Anything blocked is surfaced
  // as a structured event so the operator can see why.
  let depAdded = [];
  let depBlocked = [];
  if (autoApprove.length > 0) {
    const skillIndex = buildSkillIndex(candidates);
    const closure = resolveDependencies(autoApprove, candidatesById, {
      skillIndex,
      verdictFor: (peer) => peer?.__verdict ?? null,
    });
    depAdded = closure.added ?? [];
    depBlocked = closure.blocked ?? [];
    if (depAdded.length > 0) {
      const autoSet = new Set(autoApprove);
      const needsSet = new Set(needsDecision);
      for (const id of depAdded) {
        if (!autoSet.has(id)) {
          autoApprove.push(id);
          autoSet.add(id);
        }
        if (needsSet.has(id)) {
          needsSet.delete(id);
        }
      }
      // Rebuild needsDecision preserving order.
      const filteredNeeds = needsDecision.filter((id) => needsSet.has(id));
      needsDecision.length = 0;
      needsDecision.push(...filteredNeeds);
    }
    if (depAdded.length > 0 || depBlocked.length > 0) {
      emit({
        event: 'dependency_closure',
        added: depAdded,
        blocked: depBlocked,
      });
    }
  }

  // Stage drafts for any candidate that the policy forbids auto-approving
  // because it is a generated draft. The user can then edit the file in
  // place; on apply, evaluateEditedDraft gates the approval.
  const stagedDrafts = await stageDraftsForGenerated({
    candidates,
    candidatesById,
    needsDecision,
    projectRoot: opts.projectRoot,
    warnings: [],
  });

  emit({
    event: 'review_summary',
    total: candidates.length,
    auto_approve: autoApprove,
    needs_decision: needsDecision,
    rejected,
    policy_source: policy._source,
    drafts_staged: stagedDrafts.length,
  });

  // plan-only mode: persist a self-contained plan and exit.
  if (opts.mode === 'plan-only') {
    const plan = {
      schema_version: 1,
      project_root: opts.projectRoot,
      run_dir: runDir,
      run_id: runId,
      policy_source: policy._source,
      generated_at: new Date().toISOString(),
      candidates: candidates.map((c) => ({
        id: c.candidate_id,
        source: c.source,
        trust: c.source_trust ?? null,
        risk_flags: c.risk_flags ?? [],
        strict_gate_passed: c.strict_gate?.passed !== false,
        covered: {
          surface: c.covered_surface,
          technology: c.covered_technology,
          aspects: c.covered_aspects ?? [],
        },
        verdict: c.__verdict,
        install_target: c.install_target ?? null,
        preview: c.preview ?? null,
        action_type: c.action_type ?? null,
        draft: c.__draft ?? null,
        content_scan: c.content_scan ?? null,
        trust_signals: c.trust_signals ?? null,
      })),
      auto_approve: autoApprove,
      needs_decision: needsDecision,
      rejected,
    };
    const planPath =
      opts.planFile ?? path.join(runDir, 'orchestrator-plan.json');
    try {
      await fs.mkdir(path.dirname(planPath), { recursive: true });
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
    } catch (err) {
      fail(`could not write plan file: ${err.message}`, 7);
    }
    emit({
      event: 'completed',
      status: 'plan-ready',
      plan_path: planPath,
      run_dir: runDir,
      auto_approve_count: autoApprove.length,
      needs_decision_count: needsDecision.length,
      rejected_count: rejected.length,
    });
    return;
  }

  // Resolve manual decisions.
  let userDecisions = new Map();
  let cancelled = false;
  let bailReason = null;
  if (needsDecision.length > 0) {
    if (opts.decisionsFile) {
      const fileDecisions = await readDecisionsFile(opts.decisionsFile);
      const batch = fileDecisions.get('__batch__');
      for (const id of needsDecision) {
        if (fileDecisions.has(id)) {
          userDecisions.set(id, fileDecisions.get(id));
        } else if (batch) {
          const action = batch.remaining === 'approve_safe' ? 'approve' : 'skip';
          userDecisions.set(id, { action, source: 'decisions-file-batch' });
        } else {
          userDecisions.set(id, { action: 'skip', source: 'decisions-file-missing' });
        }
      }
    } else if (opts.headless || !opts.decisionsFromStdin) {
      const result = await applyHeadlessPolicy(new Set(needsDecision), candidatesById, policy);
      userDecisions = result.decisions;
      cancelled = result.cancelled;
      bailReason = result.reason ?? null;
    } else {
      // Interactive: emit one request_decision per candidate, then read stdin lines.
      for (const id of needsDecision) {
        const c = candidatesById.get(id);
        emit({
          event: 'request_decision',
          candidate: {
            id,
            source: c.source,
            covered: {
              surface: c.covered_surface,
              technology: c.covered_technology,
              aspects: c.covered_aspects,
            },
            trust: c.source_trust,
            risk_flags: c.risk_flags ?? [],
            verdict: c.__verdict,
            preview: c.preview ?? null,
            draft: c.__draft ?? null,
            content_scan: c.content_scan ?? null,
          },
        });
      }
      const result = await readStdinDecisions(new Set(needsDecision));
      userDecisions = result.decisions;
      cancelled = result.cancelled;
      // Anything still unresolved → skip by default (user closed input early).
      for (const id of result.unresolved ?? []) {
        if (!userDecisions.has(id)) userDecisions.set(id, { action: 'skip', source: 'unresolved' });
      }
    }
  }

  if (cancelled) {
    emit({
      event: 'completed',
      status: 'cancelled',
      reason: bailReason ?? 'user cancelled review',
      run_dir: runDir,
    });
    return;
  }

  // Final approval set, gating any edit-requested candidate through the
  // draft evaluator so unedited drafts cannot bypass review.
  const approved = [...autoApprove];
  const skipped = [];
  const editRequested = [];
  const editFailed = [];
  for (const [id, d] of userDecisions.entries()) {
    if (d.action === 'approve') approved.push(id);
    else if (d.action === 'edit') editRequested.push(id);
    else skipped.push(id);
  }

  if (editRequested.length > 0) {
    const evalResults = await resolveDraftEdits({ ids: editRequested, candidatesById });
    for (const [id, res] of evalResults.entries()) {
      if (res.ok) approved.push(id);
      else editFailed.push({ id, reason: res.reason });
    }
  }

  emit({
    event: 'install_plan',
    approved,
    skipped,
    rejected,
    edit_requested: editRequested,
    edit_failed: editFailed,
  });

  if (editFailed.length > 0 && approved.length === autoApprove.length) {
    emit({
      event: 'completed',
      status: 'paused-for-edits',
      reason: 'edited drafts did not satisfy review (unchanged or marker still present)',
      edit_paths: editRequested
        .map((id) => candidatesById.get(id)?.__draft?.path)
        .filter(Boolean),
      edit_failed: editFailed,
      run_dir: runDir,
    });
    return;
  }

  if (approved.length === 0) {
    emit({ event: 'completed', status: 'no-op', reason: 'no candidates approved', run_dir: runDir });
    return;
  }

  if (opts.noPromote) {
    emit({ event: 'completed', status: 'review-only', run_dir: runDir });
    return;
  }

  emit({ event: 'phase', name: 'review', status: 'started' });
  const reviewArgs = [
    'review',
    runDir,
    `--approve=${approved.join(',')}`,
    `--approved-by=${policy.approved_by}`,
    `--critic-verdict=${policy.critic_verdict}`,
    '--json',
  ];
  try {
    await spawnJson(PROVISION_SCRIPT, reviewArgs, { cwd: opts.projectRoot });
  } catch (err) {
    fail(`review failed: ${err.message}`, 5, { stderr: err.stderr });
  }
  emit({ event: 'phase', name: 'review', status: 'completed' });

  emit({ event: 'phase', name: 'promote', status: 'started' });
  const promoteArgs = ['promote', runDir, '--json'];
  if (policy.skill_root) promoteArgs.push(`--skill-root=${policy.skill_root}`);
  let promoteRes;
  try {
    promoteRes = await spawnJson(PROVISION_SCRIPT, promoteArgs, { cwd: opts.projectRoot });
  } catch (err) {
    fail(`promote failed: ${err.message}`, 6, { stderr: err.stderr });
  }
  emit({
    event: 'phase',
    name: 'promote',
    status: 'completed',
    manifest_path: promoteRes.parsed?.manifest_path ?? null,
  });

  emit({ event: 'phase', name: 'verify', status: 'started' });
  let verifyRes;
  try {
    verifyRes = await spawnJson(PROVISION_SCRIPT, ['verify', runDir, '--json'], {
      cwd: opts.projectRoot,
    });
  } catch (err) {
    // Verify failure is recoverable in the orchestrator: surface, but do not crash.
    emit({
      event: 'phase',
      name: 'verify',
      status: 'failed',
      message: err.message,
      stderr: err.stderr,
    });
    emit({ event: 'completed', status: 'partial', run_dir: runDir, manifest_path: promoteRes.parsed?.manifest_path ?? null });
    return;
  }
  emit({ event: 'phase', name: 'verify', status: 'completed', verified: verifyRes.parsed?.verified ?? null });
  const postVerify = await runPostInstallVerify({ runDir, projectRoot: opts.projectRoot });
  if (postVerify.ok) {
    emit({
      event: 'post_install_verify',
      verified: postVerify.report.verified,
      drift_count: postVerify.report.drift_count,
      critical_count: postVerify.report.critical_count,
      rollback_recommended: postVerify.report.rollback_recommended,
      summary: postVerify.summary,
    });
  } else {
    emit({ event: 'post_install_verify', error: postVerify.error });
  }

  // Phase 3: automatic rollback on critical drift.
  let rollbackResult = null;
  if (postVerify.ok && postVerify.report.rollback_recommended) {
    rollbackResult = await attemptAutoRollback({
      runDir,
      projectRoot: opts.projectRoot,
    });
  }
  let finalStatus;
  if (rollbackResult) {
    finalStatus = rollbackResult.ok ? 'rolled-back' : 'partial';
  } else {
    finalStatus = 'success';
  }
  // Phase 4: record telemetry only when the run actually installed skills.
  if (finalStatus === 'success') {
    await persistTelemetryForApproved({
      approved,
      candidatesById,
      projectRoot: opts.projectRoot,
    });
    await pinApprovedSkills({
      approved,
      candidatesById,
      projectRoot: opts.projectRoot,
      policy,
    });
  }
  emit({
    event: 'completed',
    status: finalStatus,
    run_dir: runDir,
    manifest_path: promoteRes.parsed?.manifest_path ?? null,
    rollback_recommended: postVerify.ok ? postVerify.report.rollback_recommended : null,
    rollback_status: rollbackResult ? (rollbackResult.ok ? 'completed' : 'failed') : null,
  });
}

async function runApplyFromPlan(opts) {
  const plan = opts.plan;
  const policy = opts.policy;
  const runDir = plan.run_dir;
  if (!runDir) fail('apply: plan.run_dir missing', 2);

  const candidatesById = new Map();
  for (const c of plan.candidates ?? []) candidatesById.set(c.id, c);

  // Build approval set: auto_approve from plan + decisions from file.
  const approved = [...(plan.auto_approve ?? [])];
  const skipped = [];
  const editRequested = [];
  const rejected = [...(plan.rejected ?? [])];

  let userDecisions = new Map();
  if (opts.decisionsFile) {
    const fileDecisions = await readDecisionsFile(opts.decisionsFile);
    const batch = fileDecisions.get('__batch__');
    for (const id of plan.needs_decision ?? []) {
      if (fileDecisions.has(id)) {
        userDecisions.set(id, fileDecisions.get(id));
      } else if (batch) {
        const action = batch.remaining === 'approve_safe' ? 'approve' : 'skip';
        userDecisions.set(id, { action, source: 'decisions-file-batch' });
      } else {
        userDecisions.set(id, { action: 'skip', source: 'decisions-file-missing' });
      }
    }
  } else {
    // No decisions file: fall back to headless policy on the plan.
    const headless = await applyHeadlessPolicy(
      new Set(plan.needs_decision ?? []),
      candidatesById,
      policy,
    );
    if (headless.cancelled) {
      emit({
        event: 'completed',
        status: 'cancelled',
        reason: headless.reason ?? 'no decisions provided',
        run_dir: runDir,
      });
      return;
    }
    userDecisions = headless.decisions;
  }

  for (const [id, d] of userDecisions.entries()) {
    if (d.action === 'approve') approved.push(id);
    else if (d.action === 'edit') editRequested.push(id);
    else if (d.action === 'reject') rejected.push(id);
    else skipped.push(id);
  }

  // Apply mode: drafts were staged during plan-only and persisted in
  // plan.candidates[i].draft. Re-hydrate so resolveDraftEdits can read them.
  for (const [id, c] of candidatesById.entries()) {
    if (c?.draft && !c.__draft) c.__draft = c.draft;
  }
  const editFailed = [];
  if (editRequested.length > 0) {
    const evalResults = await resolveDraftEdits({ ids: editRequested, candidatesById });
    for (const [id, res] of evalResults.entries()) {
      if (res.ok) approved.push(id);
      else editFailed.push({ id, reason: res.reason });
    }
  }

  emit({
    event: 'install_plan',
    approved,
    skipped,
    rejected,
    edit_requested: editRequested,
    edit_failed: editFailed,
  });

  if (editFailed.length > 0 && approved.length === (plan.auto_approve ?? []).length) {
    emit({
      event: 'completed',
      status: 'paused-for-edits',
      reason: 'edited drafts did not satisfy review (unchanged or marker still present)',
      edit_paths: editRequested
        .map((id) => candidatesById.get(id)?.__draft?.path ?? candidatesById.get(id)?.draft?.path)
        .filter(Boolean),
      edit_failed: editFailed,
      run_dir: runDir,
    });
    return;
  }
  if (approved.length === 0) {
    emit({ event: 'completed', status: 'no-op', reason: 'no candidates approved', run_dir: runDir });
    return;
  }

  emit({ event: 'phase', name: 'review', status: 'started' });
  try {
    await spawnJson(
      PROVISION_SCRIPT,
      [
        'review',
        runDir,
        `--approve=${approved.join(',')}`,
        `--approved-by=${policy.approved_by}`,
        `--critic-verdict=${policy.critic_verdict}`,
        '--json',
      ],
      { cwd: opts.projectRoot },
    );
  } catch (err) {
    fail(`review failed: ${err.message}`, 5, { stderr: err.stderr });
  }
  emit({ event: 'phase', name: 'review', status: 'completed' });

  if (opts.noPromote) {
    emit({ event: 'completed', status: 'review-only', run_dir: runDir });
    return;
  }

  emit({ event: 'phase', name: 'promote', status: 'started' });
  const promoteArgs = ['promote', runDir, '--json'];
  if (policy.skill_root) promoteArgs.push(`--skill-root=${policy.skill_root}`);
  let promoteRes;
  try {
    promoteRes = await spawnJson(PROVISION_SCRIPT, promoteArgs, { cwd: opts.projectRoot });
  } catch (err) {
    fail(`promote failed: ${err.message}`, 6, { stderr: err.stderr });
  }
  emit({
    event: 'phase',
    name: 'promote',
    status: 'completed',
    manifest_path: promoteRes.parsed?.manifest_path ?? null,
  });

  emit({ event: 'phase', name: 'verify', status: 'started' });
  let verifyRes;
  try {
    verifyRes = await spawnJson(PROVISION_SCRIPT, ['verify', runDir, '--json'], {
      cwd: opts.projectRoot,
    });
  } catch (err) {
    emit({
      event: 'phase',
      name: 'verify',
      status: 'failed',
      message: err.message,
      stderr: err.stderr,
    });
    emit({
      event: 'completed',
      status: 'partial',
      run_dir: runDir,
      manifest_path: promoteRes.parsed?.manifest_path ?? null,
    });
    return;
  }
  emit({
    event: 'phase',
    name: 'verify',
    status: 'completed',
    verified: verifyRes.parsed?.verified ?? null,
  });
  const postVerify = await runPostInstallVerify({ runDir, projectRoot: opts.projectRoot });
  if (postVerify.ok) {
    emit({
      event: 'post_install_verify',
      verified: postVerify.report.verified,
      drift_count: postVerify.report.drift_count,
      critical_count: postVerify.report.critical_count,
      rollback_recommended: postVerify.report.rollback_recommended,
      summary: postVerify.summary,
    });
  } else {
    emit({ event: 'post_install_verify', error: postVerify.error });
  }

  let rollbackResult = null;
  if (postVerify.ok && postVerify.report.rollback_recommended) {
    rollbackResult = await attemptAutoRollback({
      runDir,
      projectRoot: opts.projectRoot,
    });
  }
  let finalStatus;
  if (rollbackResult) {
    finalStatus = rollbackResult.ok ? 'rolled-back' : 'partial';
  } else {
    finalStatus = 'success';
  }
  if (finalStatus === 'success') {
    await persistTelemetryForApproved({
      approved,
      candidatesById,
      projectRoot: opts.projectRoot,
    });
    await pinApprovedSkills({
      approved,
      candidatesById,
      projectRoot: opts.projectRoot,
      policy,
    });
  }
  emit({
    event: 'completed',
    status: finalStatus,
    run_dir: runDir,
    manifest_path: promoteRes.parsed?.manifest_path ?? null,
    rollback_recommended: postVerify.ok ? postVerify.report.rollback_recommended : null,
    rollback_status: rollbackResult ? (rollbackResult.ok ? 'completed' : 'failed') : null,
  });
}

async function main(argv) {
  const opts = parseArgs(argv);
  emit({
    event: 'started',
    project_root: opts.projectRoot,
    headless: opts.headless,
    decisions_from_stdin: opts.decisionsFromStdin,
  });
  try {
    await runOrchestration(opts);
  } catch (err) {
    fail(err.message ?? String(err), 1, { stack: err.stack });
  }
}

const invokedAsScript = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(new URL(import.meta.url).pathname);
})();

if (invokedAsScript) {
  main(process.argv.slice(2));
}

export {
  parseArgs,
  classifyCandidate,
  readPolicy,
  autoDetectAdr,
  applyHeadlessPolicy,
  attemptAutoRollback,
  maybeOpportunisticRevalidation,
  maybeCleanupProposal,
  annotateCveFlags,
  persistTelemetryForApproved,
  annotateTofuDrift,
  annotateSandboxFingerprints,
  pinApprovedSkills,
  DEFAULT_POLICY,
};

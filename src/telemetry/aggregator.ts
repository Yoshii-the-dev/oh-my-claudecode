/**
 * Telemetry Aggregator
 *
 * Reads JSONL telemetry streams + .omc/self-improve/tracking/raw_data.json (read-only)
 * and writes Markdown digests to .omc/telemetry/digests/.
 *
 * Two modes:
 * - trigger='on-demand'   → digests/daily/<YYYY-MM-DD>.md + update digests/latest.md
 * - trigger='session-end' → digests/session/<sessionId>.md
 *
 * Metrics computed from Phase 1 streams (plan Section 7):
 * - agent_handoff_count_by_type
 * - verdict_distribution
 * - avg_handoff_duration_ms (from verdict.duration_ms)
 * - skill_invocation_count
 * - skill_keyword_hit_rate
 * - hook_event_volume
 * - plugin_version_distribution
 * - self_improve_tournament_state (read-only panel, skipped if file absent)
 * - top-3 highest-volume agents / skills / hooks
 *
 * LLM metrics are Phase 2 placeholders — not computed here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamName } from './schemas.js';
import type { SelfImproveRawData } from './alias-reader.js';
import { readSelfImproveRawData } from './alias-reader.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AggregateOptions {
  directory: string;
  /** 'on-demand' | 'session-end'; influences scope (full daily vs single session). */
  trigger: 'on-demand' | 'session-end';
  /** Required when trigger='session-end'. */
  sessionId?: string;
}

/**
 * Read JSONL streams + self-improve raw_data.json (read-only) and write
 * Markdown digests under .omc/telemetry/digests/.
 * Returns { digestPath }.
 * Never throws — failures are logged to stderr.
 */
export async function aggregate(options: AggregateOptions): Promise<{ digestPath: string }> {
  const { directory, trigger, sessionId } = options;

  try {
    const eventsDir = join(directory, '.omc', 'telemetry', 'events');
    const digestsDir = join(directory, '.omc', 'telemetry', 'digests');

    // Read all relevant events
    const agentHandoffs = readJsonlStream(join(eventsDir, 'agent-handoff.jsonl'));
    const verdicts = readJsonlStream(join(eventsDir, 'verdict.jsonl'));
    const skillEvents = readJsonlStream(join(eventsDir, 'skill-events.jsonl'));
    const hookEvents = readJsonlStream(join(eventsDir, 'hook-events.jsonl'));

    // Filter to session scope if session-end
    const isSessionEnd = trigger === 'session-end';
    const filterFn = isSessionEnd && sessionId
      ? (e: Record<string, unknown>) => e['session_id'] === sessionId
      : () => true;

    const filteredHandoffs = agentHandoffs.filter(filterFn);
    const filteredVerdicts = verdicts.filter(filterFn);
    const filteredSkills = skillEvents.filter(filterFn);
    const filteredHooks = hookEvents.filter(filterFn);

    // Combine all events for shared metrics (e.g. plugin_version_distribution)
    const allEvents = [
      ...filteredHandoffs,
      ...filteredVerdicts,
      ...filteredSkills,
      ...filteredHooks,
    ];

    // Self-improve data (read-only)
    const selfImproveData = readSelfImproveRawData(directory);

    // Compute metrics
    const metrics = computeMetrics(filteredHandoffs, filteredVerdicts, filteredSkills, filteredHooks, allEvents);

    // Build digest
    const now = new Date();
    const windowLabel = isSessionEnd
      ? `Session ${sessionId ?? 'unknown'}`
      : `Daily — ${toDateString(now)}`;
    const digest = renderDigest(windowLabel, now, metrics, selfImproveData);

    // Determine digest path
    let digestPath: string;
    if (isSessionEnd) {
      const sessionDigestDir = join(digestsDir, 'session');
      mkdirSync(sessionDigestDir, { recursive: true });
      digestPath = join(sessionDigestDir, `${sessionId ?? 'unknown'}.md`);
    } else {
      const dailyDir = join(digestsDir, 'daily');
      mkdirSync(dailyDir, { recursive: true });
      digestPath = join(dailyDir, `${toDateString(now)}.md`);
    }

    writeFileSync(digestPath, digest, 'utf-8');

    // Update latest.md symlink/copy for on-demand daily
    if (!isSessionEnd) {
      const latestPath = join(digestsDir, 'latest.md');
      try {
        if (existsSync(latestPath)) unlinkSync(latestPath);
        // Use a copy (not symlink) for cross-platform compatibility
        writeFileSync(latestPath, digest, 'utf-8');
      } catch {
        // Non-critical — ignore
      }
    }

    return { digestPath };
  } catch (err) {
    process.stderr.write(`[telemetry/aggregator] error: ${(err as Error).message}\n`);
    // Return a fallback path so callers don't crash
    const fallbackPath = join(directory, '.omc', 'telemetry', 'digests', 'error.md');
    return { digestPath: fallbackPath };
  }
}

// ---------------------------------------------------------------------------
// JSONL reader
// ---------------------------------------------------------------------------

function readJsonlStream(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as Record<string, unknown>; }
        catch { return null; }
      })
      .filter((e): e is Record<string, unknown> => e !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

interface AggregatedMetrics {
  // agent-handoff
  handoffCountByType: Record<string, number>;
  // verdict
  verdictDistribution: Record<string, number>;
  avgDurationMs: number | null;
  // skill-events
  skillInvocationCount: Record<string, number>;
  skillKeywordHitRate: number | null;
  // hook-events
  hookEventVolume: Record<string, number>;
  // cross-stream
  pluginVersionDistribution: Record<string, number>;
  // top-3
  top3Agents: Array<[string, number]>;
  top3Skills: Array<[string, number]>;
  top3Hooks: Array<[string, number]>;
  // totals
  totalHandoffs: number;
  totalVerdicts: number;
  totalSkillEvents: number;
  totalHookEvents: number;
  skippedLegacy: number;
}

function computeMetrics(
  handoffs: Record<string, unknown>[],
  verdicts: Record<string, unknown>[],
  skills: Record<string, unknown>[],
  hooks: Record<string, unknown>[],
  allEvents: Record<string, unknown>[],
): AggregatedMetrics {
  // Skip legacy envelopes (no plugin_version)
  let skippedLegacy = 0;
  const hasAttribution = (e: Record<string, unknown>) => {
    if (!e['plugin_version']) { skippedLegacy++; return false; }
    return true;
  };

  // Don't filter legacy from volume counts — plan says they count for volume metrics
  // but not cross-version metrics. We count all, mark legacy separately.
  void hasAttribution; // used for skippedLegacy only
  allEvents.forEach(e => { if (!e['plugin_version']) skippedLegacy++; });

  // --- agent-handoff
  const handoffCountByType: Record<string, number> = {};
  for (const e of handoffs) {
    const t = String(e['agent_type'] ?? 'unknown');
    handoffCountByType[t] = (handoffCountByType[t] ?? 0) + 1;
  }

  // --- verdict
  const verdictDistribution: Record<string, number> = {};
  let durationSum = 0;
  let durationCount = 0;
  for (const e of verdicts) {
    const v = String(e['verdict'] ?? 'unknown');
    verdictDistribution[v] = (verdictDistribution[v] ?? 0) + 1;
    const dur = e['duration_ms'];
    if (typeof dur === 'number') { durationSum += dur; durationCount++; }
  }
  const avgDurationMs = durationCount > 0 ? durationSum / durationCount : null;

  // --- skill-events
  const skillInvocationCount: Record<string, number> = {};
  let skillWithKeyword = 0;
  for (const e of skills) {
    const slug = String(e['skill_slug'] ?? 'unknown');
    skillInvocationCount[slug] = (skillInvocationCount[slug] ?? 0) + 1;
    if (e['keyword']) skillWithKeyword++;
  }
  const skillKeywordHitRate = skills.length > 0 ? skillWithKeyword / skills.length : null;

  // --- hook-events
  const hookEventVolume: Record<string, number> = {};
  for (const e of hooks) {
    const hn = String(e['hook_name'] ?? 'unknown');
    hookEventVolume[hn] = (hookEventVolume[hn] ?? 0) + 1;
  }

  // --- plugin_version_distribution (all events)
  const pluginVersionDistribution: Record<string, number> = {};
  for (const e of allEvents) {
    const pv = String(e['plugin_version'] ?? 'pre-telemetry');
    pluginVersionDistribution[pv] = (pluginVersionDistribution[pv] ?? 0) + 1;
  }

  // --- top-3
  const top3Agents = top3(handoffCountByType);
  const top3Skills = top3(skillInvocationCount);
  const top3Hooks = top3(hookEventVolume);

  return {
    handoffCountByType,
    verdictDistribution,
    avgDurationMs,
    skillInvocationCount,
    skillKeywordHitRate,
    hookEventVolume,
    pluginVersionDistribution,
    top3Agents,
    top3Skills,
    top3Hooks,
    totalHandoffs: handoffs.length,
    totalVerdicts: verdicts.length,
    totalSkillEvents: skills.length,
    totalHookEvents: hooks.length,
    skippedLegacy,
  };
}

function top3(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function renderDigest(
  windowLabel: string,
  generatedAt: Date,
  metrics: AggregatedMetrics,
  selfImprove: SelfImproveRawData | null,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# OMC Telemetry Digest`);
  lines.push('');
  lines.push(`**Window:** ${windowLabel}`);
  lines.push(`**Generated at:** ${generatedAt.toISOString()}`);
  if (metrics.skippedLegacy > 0) {
    lines.push(`**Skipped legacy events** (no plugin_version): ${metrics.skippedLegacy}`);
  }
  lines.push('');

  // Agent Handoffs
  lines.push('## Agent Handoffs');
  lines.push('');
  lines.push(`Total: **${metrics.totalHandoffs}**`);
  if (Object.keys(metrics.handoffCountByType).length > 0) {
    lines.push('');
    lines.push('| Agent Type | Count |');
    lines.push('|---|---|');
    for (const [t, c] of Object.entries(metrics.handoffCountByType).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${t} | ${c} |`);
    }
  }
  lines.push('');

  // Verdicts
  lines.push('## Verdicts');
  lines.push('');
  lines.push(`Total: **${metrics.totalVerdicts}**`);
  if (Object.keys(metrics.verdictDistribution).length > 0) {
    lines.push('');
    lines.push('| Verdict | Count |');
    lines.push('|---|---|');
    for (const [v, c] of Object.entries(metrics.verdictDistribution).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${v} | ${c} |`);
    }
  }
  if (metrics.avgDurationMs !== null) {
    lines.push('');
    lines.push(`Avg duration: **${metrics.avgDurationMs.toFixed(1)}ms**`);
  }
  lines.push('');

  // Skill Events
  lines.push('## Skill Events');
  lines.push('');
  lines.push(`Total: **${metrics.totalSkillEvents}**`);
  if (metrics.skillKeywordHitRate !== null) {
    lines.push(`Keyword hit rate: **${(metrics.skillKeywordHitRate * 100).toFixed(1)}%**`);
  }
  if (Object.keys(metrics.skillInvocationCount).length > 0) {
    lines.push('');
    lines.push('| Skill | Invocations |');
    lines.push('|---|---|');
    for (const [s, c] of Object.entries(metrics.skillInvocationCount).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${s} | ${c} |`);
    }
  }
  lines.push('');

  // Hook Events
  lines.push('## Hook Events');
  lines.push('');
  lines.push(`Total: **${metrics.totalHookEvents}**`);
  if (Object.keys(metrics.hookEventVolume).length > 0) {
    lines.push('');
    lines.push('| Hook | Events |');
    lines.push('|---|---|');
    for (const [h, c] of Object.entries(metrics.hookEventVolume).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${h} | ${c} |`);
    }
  }
  lines.push('');

  // Plugin Version Distribution
  lines.push('## Plugin Version Distribution');
  lines.push('');
  if (Object.keys(metrics.pluginVersionDistribution).length > 0) {
    lines.push('| Version | Events |');
    lines.push('|---|---|');
    for (const [v, c] of Object.entries(metrics.pluginVersionDistribution).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${v} | ${c} |`);
    }
  } else {
    lines.push('_No events recorded._');
  }
  lines.push('');

  // Top-3 tables
  lines.push('## Top Volume');
  lines.push('');
  if (metrics.top3Agents.length > 0) {
    lines.push('**Top agents:**');
    for (const [name, count] of metrics.top3Agents) {
      lines.push(`- ${name}: ${count}`);
    }
    lines.push('');
  }
  if (metrics.top3Skills.length > 0) {
    lines.push('**Top skills:**');
    for (const [name, count] of metrics.top3Skills) {
      lines.push(`- ${name}: ${count}`);
    }
    lines.push('');
  }
  if (metrics.top3Hooks.length > 0) {
    lines.push('**Top hooks:**');
    for (const [name, count] of metrics.top3Hooks) {
      lines.push(`- ${name}: ${count}`);
    }
    lines.push('');
  }

  // Self-Improve Panel (read-only, skip if absent)
  if (selfImprove !== null) {
    lines.push('## Self-Improve Panel');
    lines.push('');
    if (typeof selfImprove.generation === 'number') {
      lines.push(`**Tournament generation:** ${selfImprove.generation}`);
    }
    if (typeof selfImprove.leader === 'string') {
      lines.push(`**Current leader:** ${selfImprove.leader}`);
    }
    const candidates = selfImprove.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      lines.push('');
      lines.push('| Candidate | Score | Wins | Losses |');
      lines.push('|---|---|---|---|');
      for (const c of candidates) {
        lines.push(`| ${c.candidate_id} | ${c.score ?? '-'} | ${c.wins ?? '-'} | ${c.losses ?? '-'} |`);
      }
    }
    lines.push('');
    lines.push('_Self-improve data is read-only. This panel is informational only._');
    lines.push('');
  }

  // LLM Metrics placeholder (Phase 2)
  lines.push('## LLM Metrics');
  lines.push('');
  lines.push('_Phase 2 — llm-interaction.jsonl stream not yet populated._');
  lines.push('');

  return lines.join('\n');
}

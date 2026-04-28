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
 * Metrics computed from Phase 1+2 streams (plan Section 7):
 * - agent_handoff_count_by_type
 * - verdict_distribution
 * - avg_handoff_duration_ms (from verdict.duration_ms)
 * - skill_invocation_count
 * - skill_keyword_hit_rate
 * - hook_event_volume
 * - plugin_version_distribution
 * - self_improve_tournament_state (read-only panel, skipped if file absent)
 * - top-3 highest-volume agents / skills / hooks
 * - llm_token_burn_by_agent (Phase 2, from llm-interaction.jsonl)
 * - llm_cache_hit_rate (Phase 2, from llm-interaction.jsonl)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
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
    const llmInteractions = readJsonlStream(join(eventsDir, 'llm-interaction.jsonl'));
    const productCycleEvents = readJsonlStream(join(eventsDir, 'product-cycle-events.jsonl'));

    // Filter to session scope if session-end
    const isSessionEnd = trigger === 'session-end';
    const filterFn = isSessionEnd && sessionId
      ? (e: Record<string, unknown>) => e['session_id'] === sessionId
      : () => true;

    const filteredHandoffs = agentHandoffs.filter(filterFn);
    const filteredVerdicts = verdicts.filter(filterFn);
    const filteredSkills = skillEvents.filter(filterFn);
    const filteredHooks = hookEvents.filter(filterFn);
    const filteredLlm = llmInteractions.filter(filterFn);
    const filteredProductCycles = productCycleEvents.filter(filterFn);

    // Combine all events for shared metrics (e.g. plugin_version_distribution)
    const allEvents = [
      ...filteredHandoffs,
      ...filteredVerdicts,
      ...filteredSkills,
      ...filteredHooks,
      ...filteredLlm,
      ...filteredProductCycles,
    ];

    // Self-improve data (read-only)
    const selfImproveData = readSelfImproveRawData(directory);

    // Compute metrics
    const metrics = computeMetrics(
      filteredHandoffs,
      filteredVerdicts,
      filteredSkills,
      filteredHooks,
      filteredLlm,
      filteredProductCycles,
      allEvents,
    );

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

interface LlmAgentStats {
  tokens_in: number;
  tokens_out: number;
  total: number;
}

interface ProductCycleMetrics {
  eventCount: number;
  cycleUnclosedRate: number | null;
  manualHandoffRate: number | null;
  researchRouteHitRate: number | null;
  buildAutoCompletionRate: number | null;
  teamWaitFailureRate: number | null;
  avgTimeToBuildCompleteMs: number | null;
  eventCounts: Record<string, number>;
}

interface AggregatedMetrics {
  // agent-handoff
  handoffCountByType: Record<string, number>;
  // verdict
  verdictDistribution: Record<string, number>;
  avgDurationMs: number | null;
  // skill-events
  skillInvocationCount: Record<string, number>;
  skillKeywordHitRate: number | null;
  avgLatencyBySkill: Record<string, number>;
  // hook-events
  hookEventVolume: Record<string, number>;
  avgLatencyByHook: Record<string, number>;
  // llm-interaction (Phase 2)
  llmTokenBurnByAgent: Record<string, LlmAgentStats>;
  llmCacheHitRate: number | null;   // null means n/a (no cache_read data)
  totalLlmInteractions: number;
  // product-cycle-events
  productCycle: ProductCycleMetrics;
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
  llmInteractions: Record<string, unknown>[],
  productCycleEvents: Record<string, unknown>[],
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

  const skillInvocationCount: Record<string, number> = {};
  const skillLatencySum: Record<string, number> = {};
  const skillLatencyCount: Record<string, number> = {};
  let skillWithKeyword = 0;
  for (const e of skills) {
    const slug = String(e['skill_slug'] ?? 'unknown');
    skillInvocationCount[slug] = (skillInvocationCount[slug] ?? 0) + 1;
    if (e['keyword']) skillWithKeyword++;
    const lat = e['latency_ms'];
    if (typeof lat === 'number') {
      skillLatencySum[slug] = (skillLatencySum[slug] ?? 0) + lat;
      skillLatencyCount[slug] = (skillLatencyCount[slug] ?? 0) + 1;
    }
  }
  const skillKeywordHitRate = skills.length > 0 ? skillWithKeyword / skills.length : null;
  const avgLatencyBySkill: Record<string, number> = {};
  for (const slug in skillLatencyCount) {
    avgLatencyBySkill[slug] = skillLatencySum[slug] / skillLatencyCount[slug];
  }

  // --- hook-events
  const hookEventVolume: Record<string, number> = {};
  const hookLatencySum: Record<string, number> = {};
  const hookLatencyCount: Record<string, number> = {};
  for (const e of hooks) {
    const hn = String(e['hook_name'] ?? 'unknown');
    hookEventVolume[hn] = (hookEventVolume[hn] ?? 0) + 1;
    const lat = e['latency_ms'];
    if (typeof lat === 'number') {
      hookLatencySum[hn] = (hookLatencySum[hn] ?? 0) + lat;
      hookLatencyCount[hn] = (hookLatencyCount[hn] ?? 0) + 1;
    }
  }
  const avgLatencyByHook: Record<string, number> = {};
  for (const hn in hookLatencyCount) {
    avgLatencyByHook[hn] = hookLatencySum[hn] / hookLatencyCount[hn];
  }

  // --- plugin_version_distribution (all events)
  const pluginVersionDistribution: Record<string, number> = {};
  for (const e of allEvents) {
    const pv = String(e['plugin_version'] ?? 'pre-telemetry');
    pluginVersionDistribution[pv] = (pluginVersionDistribution[pv] ?? 0) + 1;
  }

  // --- llm-interaction (Phase 2)
  const llmTokenBurnByAgent: Record<string, LlmAgentStats> = {};
  let llmTotalTokensIn = 0;
  let llmTotalCacheRead = 0;
  let llmHasCacheData = false;
  for (const e of llmInteractions) {
    // agent_id is on the envelope; fall back to 'unknown'
    const agentKey = String(e['agent_id'] ?? 'unknown');
    const tokIn = typeof e['tokens_in'] === 'number' ? e['tokens_in'] : 0;
    const tokOut = typeof e['tokens_out'] === 'number' ? e['tokens_out'] : 0;
    const cacheRead = typeof e['cache_read'] === 'number' ? e['cache_read'] : 0;

    if (!llmTokenBurnByAgent[agentKey]) {
      llmTokenBurnByAgent[agentKey] = { tokens_in: 0, tokens_out: 0, total: 0 };
    }
    llmTokenBurnByAgent[agentKey].tokens_in += tokIn;
    llmTokenBurnByAgent[agentKey].tokens_out += tokOut;
    llmTokenBurnByAgent[agentKey].total += tokIn + tokOut;

    llmTotalTokensIn += tokIn;
    llmTotalCacheRead += cacheRead;
    if (cacheRead > 0) llmHasCacheData = true;
  }
  // llm_cache_hit_rate = cache_read / tokens_in; null if no cache data or zero tokens
  const llmCacheHitRate =
    llmHasCacheData && llmTotalTokensIn > 0
      ? llmTotalCacheRead / llmTotalTokensIn
      : null;

  const productCycle = computeProductCycleMetrics(productCycleEvents);

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
    avgLatencyBySkill,
    hookEventVolume,
    avgLatencyByHook,
    llmTokenBurnByAgent,
    llmCacheHitRate,
    totalLlmInteractions: llmInteractions.length,
    productCycle,
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

function computeProductCycleMetrics(events: Record<string, unknown>[]): ProductCycleMetrics {
  const eventCounts: Record<string, number> = {};
  for (const event of events) {
    const name = String(event['event'] ?? 'unknown');
    eventCounts[name] = (eventCounts[name] ?? 0) + 1;
  }

  const runStopped = events.filter((event) => event['event'] === 'product_cycle_run_stopped');
  const unclosed = runStopped.filter((event) => event['stopped_reason'] !== 'complete');

  const manualHandoffs = events.filter((event) => event['event'] === 'manual_handoff');
  const automationClosures = events.filter((event) => (
    event['event'] === 'build_auto_completed'
    || event['event'] === 'research_auto_resumed'
  ));

  const specBuildDecisions = events.filter((event) => (
    event['event'] === 'stage_decision'
    && (event['cycle_stage'] === 'spec' || event['cycle_stage'] === 'build')
  ));
  const researchHits = specBuildDecisions.filter((event) => event['has_research'] === true);

  const buildPlanned = events.filter((event) => event['event'] === 'build_intervention_planned');
  const buildCompleted = events.filter((event) => event['event'] === 'build_auto_completed');

  const teamCompleted = events.filter((event) => event['event'] === 'build_team_completed');
  const teamFailed = events.filter((event) => event['event'] === 'build_team_failed');

  return {
    eventCount: events.length,
    cycleUnclosedRate: ratioOrNull(unclosed.length, runStopped.length),
    manualHandoffRate: ratioOrNull(manualHandoffs.length, manualHandoffs.length + automationClosures.length),
    researchRouteHitRate: ratioOrNull(researchHits.length, specBuildDecisions.length),
    buildAutoCompletionRate: ratioOrNull(buildCompleted.length, buildPlanned.length),
    teamWaitFailureRate: ratioOrNull(teamFailed.length, teamCompleted.length + teamFailed.length),
    avgTimeToBuildCompleteMs: averageBuildCompletionMs(events),
    eventCounts,
  };
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function averageBuildCompletionMs(events: Record<string, unknown>[]): number | null {
  const plannedByCycle = new Map<string, number>();
  const durations: number[] = [];

  for (const event of events) {
    const name = event['event'];
    const cycleId = typeof event['cycle_id'] === 'string' && event['cycle_id'].trim()
      ? event['cycle_id']
      : undefined;
    const ts = typeof event['ts'] === 'string' ? Date.parse(event['ts']) : NaN;
    if (!cycleId || !Number.isFinite(ts)) continue;

    if (name === 'build_intervention_planned') {
      plannedByCycle.set(cycleId, ts);
    } else if (name === 'build_auto_completed') {
      const plannedAt = plannedByCycle.get(cycleId);
      if (plannedAt != null && ts >= plannedAt) {
        durations.push(ts - plannedAt);
      }
    }
  }

  if (durations.length === 0) return null;
  return durations.reduce((sum, value) => sum + value, 0) / durations.length;
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

function formatPercentMetric(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatDurationMetric(valueMs: number | null): string {
  if (valueMs === null) return 'n/a';
  if (valueMs < 1000) return `${valueMs.toFixed(0)}ms`;
  const seconds = valueMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
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
    lines.push('| Skill | Invocations | Avg Latency |');
    lines.push('|---|---|---|');
    for (const [s, c] of Object.entries(metrics.skillInvocationCount).sort((a, b) => b[1] - a[1])) {
      const avgLat = metrics.avgLatencyBySkill[s];
      const latStr = avgLat !== undefined ? `${avgLat.toFixed(1)}ms` : '-';
      lines.push(`| ${s} | ${c} | ${latStr} |`);
    }
  }
  lines.push('');

  // Hook Events
  lines.push('## Hook Events');
  lines.push('');
  lines.push(`Total: **${metrics.totalHookEvents}**`);
  if (Object.keys(metrics.hookEventVolume).length > 0) {
    lines.push('');
    lines.push('| Hook | Events | Avg Latency |');
    lines.push('|---|---|---|');
    for (const [h, c] of Object.entries(metrics.hookEventVolume).sort((a, b) => b[1] - a[1])) {
      const avgLat = metrics.avgLatencyByHook[h];
      const latStr = avgLat !== undefined ? `${avgLat.toFixed(1)}ms` : '-';
      lines.push(`| ${h} | ${c} | ${latStr} |`);
    }
  }
  lines.push('');

  // Product Cycle Events
  lines.push('## Product Cycle Events');
  lines.push('');
  lines.push(`Total: **${metrics.productCycle.eventCount}**`);
  lines.push(`Cycle unclosed rate: **${formatPercentMetric(metrics.productCycle.cycleUnclosedRate)}**`);
  lines.push(`Manual handoff rate: **${formatPercentMetric(metrics.productCycle.manualHandoffRate)}**`);
  lines.push(`Research route hit rate: **${formatPercentMetric(metrics.productCycle.researchRouteHitRate)}**`);
  lines.push(`Build auto-completion rate: **${formatPercentMetric(metrics.productCycle.buildAutoCompletionRate)}**`);
  lines.push(`Team wait failure rate: **${formatPercentMetric(metrics.productCycle.teamWaitFailureRate)}**`);
  lines.push(`Avg time to build complete: **${formatDurationMetric(metrics.productCycle.avgTimeToBuildCompleteMs)}**`);
  if (Object.keys(metrics.productCycle.eventCounts).length > 0) {
    lines.push('');
    lines.push('| Event | Count |');
    lines.push('|---|---|');
    for (const [event, count] of Object.entries(metrics.productCycle.eventCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${event} | ${count} |`);
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

  // LLM Interaction (Phase 2)
  lines.push('## LLM Interaction');
  lines.push('');
  lines.push(`Total interactions: **${metrics.totalLlmInteractions}**`);
  lines.push('');

  // llm_token_burn_by_agent
  lines.push('### Token Burn by Agent');
  lines.push('');
  const burnEntries = Object.entries(metrics.llmTokenBurnByAgent)
    .sort((a, b) => b[1].total - a[1].total);
  if (burnEntries.length > 0) {
    lines.push('| Agent | Tokens In | Tokens Out | Total |');
    lines.push('|---|---|---|---|');
    for (const [agent, stats] of burnEntries) {
      lines.push(`| ${agent} | ${stats.tokens_in} | ${stats.tokens_out} | ${stats.total} |`);
    }
  } else {
    lines.push('_No LLM interaction data recorded._');
  }
  lines.push('');

  // llm_cache_hit_rate
  lines.push('### Cache Hit Rate');
  lines.push('');
  if (metrics.llmCacheHitRate !== null) {
    lines.push(`Overall: **${(metrics.llmCacheHitRate * 100).toFixed(1)}%** (cache_read / tokens_in)`);
  } else {
    lines.push('Overall: **n/a** (no cache_read data recorded)');
  }
  lines.push('');

  return lines.join('\n');
}

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
export declare function aggregate(options: AggregateOptions): Promise<{
    digestPath: string;
}>;
//# sourceMappingURL=aggregator.d.ts.map
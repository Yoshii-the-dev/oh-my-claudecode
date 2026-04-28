/**
 * aggregator.test.ts
 *
 * Covers:
 * - on-demand trigger produces digests/daily/<YYYY-MM-DD>.md + latest.md
 * - session-end trigger produces digests/session/<sessionId>.md
 * - digest contains expected metric sections
 * - self-improve panel appears when raw_data.json present
 * - self-improve panel is skipped silently when file absent
 * - plugin_version_distribution appears in digest
 * - top-3 sections appear when data exists
 * - aggregate never throws even on errors
 */
export {};
//# sourceMappingURL=aggregator.test.d.ts.map
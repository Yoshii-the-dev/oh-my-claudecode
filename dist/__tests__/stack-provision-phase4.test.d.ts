/**
 * Phase 4 tests for stack-provision maintenance layer:
 *   - telemetry.mjs       (per-skill usage counters, unused detection)
 *   - revalidation.mjs    (opportunistic cron + manifest re-hash)
 *   - cve-feed.mjs        (OSV.dev adapter + severity classification)
 *   - auto-cleanup.mjs    (deprecation proposals based on telemetry)
 *   - orchestrate.mjs::annotateCveFlags + persistTelemetryForApproved
 *
 * All network calls are stubbed via fetchImpl/fsImpl; no real HTTP and no
 * real ~/.claude scans during tests.
 */
export {};
//# sourceMappingURL=stack-provision-phase4.test.d.ts.map
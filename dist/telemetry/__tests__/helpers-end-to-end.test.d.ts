/**
 * helpers-end-to-end.test.ts
 *
 * Regression test for the strict-schema vs helper-payload mismatch fix.
 *
 * Each high-level helper (emitAgentHandoff, emitVerdict, emitToolCall,
 * emitHookEvent, emitUserCorrection, emitLlmInteraction) passes
 * session_id / run_id / agent_id inside the payload object.  Before the fix
 * those envelope-level fields leaked into the strict Zod validation and caused
 * a silent drop with a stderr warning.  This test catches that regression.
 *
 * For each helper we:
 *  1. Set up a tmp directory with the version-attribution prerequisites.
 *  2. Capture stderr to assert NO "payload validation failed" warning.
 *  3. Call the helper with realistic args including session_id / agent_id.
 *  4. Read back the JSONL file and assert:
 *     - at least one line was written
 *     - the line parses as valid JSON
 *     - session_id / agent_id appear at the ENVELOPE top level
 *     - they do NOT appear inside a nested "payload" sub-object
 *     - attribution fields (plugin_version, omc_config_hash, install_id) are present
 */
export {};
//# sourceMappingURL=helpers-end-to-end.test.d.ts.map
/**
 * writer.concurrency.test.ts
 *
 * Proves no torn writes / no corruption under concurrent load.
 *
 * Spawns 4 concurrent writers via Promise.all — each calls emit() 250 times
 * against the SAME tmp directory and SAME stream file.
 * Total: 1000 emits to one file.
 *
 * After flush: reads the JSONL file, asserts exactly 1000 lines, each line
 * parses as JSON, each has plugin_version, omc_config_hash, install_id.
 *
 * NOTE: appendFileSync is safe for concurrent writes up to PIPE_BUF (typically
 * 4 KB on Linux/macOS) because the OS guarantees atomic writes at that size.
 * Our envelopes are well under 4 KB, so this test should pass with the current
 * synchronous writer.  If it fails under stress, that indicates a real
 * production risk and must be fixed in the writer, not worked around here.
 */
export {};
//# sourceMappingURL=writer.concurrency.test.d.ts.map
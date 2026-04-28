/**
 * stack-provision install-target normalization + TOFU strict-gate.
 *
 * Targets the regression where skills.sh search returns slug-only IDs
 * (e.g. `supabase-postgres-best-practices`), but `npx skills add` requires
 * `<org>/<repo>`. The orchestrator now extracts the repo path from the
 * entry's github URL or, failing that, emits a clean `external-command-unresolved`
 * action with `unresolvable-install-target` risk flag rather than a broken
 * `npx skills add <slug>` command that silently fails.
 *
 * Also covers TOFU (trust-on-first-use): high-trust candidates without a
 * sha256 should pass the strict gate with `tofu_pending: true` so they can
 * be auto-installed once and pinned thereafter.
 */
export {};
//# sourceMappingURL=stack-provision-install-target.test.d.ts.map
/**
 * Plugin Version Attribution
 *
 * Provides stable version attribution fields for every telemetry envelope.
 * All hashes are sha256 first 16 hex chars (Section 11.6).
 * In-process caching with 30s memoization for omc_config_hash (Section 11.4).
 */
/**
 * Generates and persists a per-install UUID.
 * Returns existing one if already present. Mode 0600.
 */
export declare function getOrCreateInstallId(directory: string): string;
/**
 * Returns { plugin_version, omc_config_hash, install_id }.
 * Cached for the process lifetime (omc_config_hash: 30s memoization).
 */
export declare function getBaseAttribution(directory: string): {
    plugin_version: string;
    omc_config_hash: string;
    install_id: string;
};
/**
 * Returns sha256-16 of agents/<agentType>.md, or undefined if not found. Cached.
 */
export declare function getAgentPromptHash(directory: string, agentType: string): string | undefined;
/**
 * Returns sha256-16 of skills/<slug>/SKILL.md, or undefined if not found. Cached.
 */
export declare function getSkillContentHash(directory: string, slug: string): string | undefined;
/**
 * Returns sha256-16 of src/hooks/<name>/index.ts, or undefined if not found. Cached.
 */
export declare function getHookVersionHash(directory: string, hookName: string): string | undefined;
/**
 * Reset in-process caches (for testing only).
 * @internal
 */
export declare function resetAttributionCaches(): void;
//# sourceMappingURL=version-attribution.d.ts.map
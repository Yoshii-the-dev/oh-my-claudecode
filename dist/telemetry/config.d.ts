/**
 * Telemetry Configuration
 *
 * Reads telemetry settings from .claude/settings.json and .claude/omc.jsonc.
 * Respects OMC_TELEMETRY_DISABLE=1 kill-switch.
 */
export interface TelemetryConfig {
    /** Whether telemetry is enabled. Kill-switch via env or config. */
    enabled: boolean;
    /** Max JSONL file size in bytes before rotation (default 8 MB). */
    maxFileBytes: number;
    /** Max archive age in days before GC (default 30). */
    maxArchiveDays: number;
}
/**
 * Load telemetry config from .claude/settings.json and .claude/omc.jsonc.
 * Environment kill-switch takes precedence over config file.
 */
export declare function loadTelemetryConfig(directory: string): TelemetryConfig;
/**
 * Returns true if telemetry is enabled for the given directory.
 */
export declare function isTelemetryEnabled(directory: string): boolean;
//# sourceMappingURL=config.d.ts.map
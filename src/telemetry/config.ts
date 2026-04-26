/**
 * Telemetry Configuration
 *
 * Reads telemetry settings from .claude/settings.json and .claude/omc.jsonc.
 * Respects OMC_TELEMETRY_DISABLE=1 kill-switch.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TelemetryConfig {
  /** Whether telemetry is enabled. Kill-switch via env or config. */
  enabled: boolean;
  /** Max JSONL file size in bytes before rotation (default 8 MB). */
  maxFileBytes: number;
  /** Max archive age in days before GC (default 30). */
  maxArchiveDays: number;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  maxFileBytes: 8 * 1024 * 1024,
  maxArchiveDays: 30,
};

/**
 * Load telemetry config from .claude/settings.json and .claude/omc.jsonc.
 * Environment kill-switch takes precedence over config file.
 */
export function loadTelemetryConfig(directory: string): TelemetryConfig {
  // Env kill-switch always wins
  if (process.env['OMC_TELEMETRY_DISABLE'] === '1') {
    return { ...DEFAULT_CONFIG, enabled: false };
  }

  const config: TelemetryConfig = { ...DEFAULT_CONFIG };

  // Try to read from .claude/omc.jsonc
  const omcJsoncPath = join(directory, '.claude', 'omc.jsonc');
  if (existsSync(omcJsoncPath)) {
    try {
      const raw = readFileSync(omcJsoncPath, 'utf-8');
      // Strip JSONC comments
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const parsed = JSON.parse(stripped);
      const telemetry = parsed?.telemetry;
      if (telemetry && typeof telemetry === 'object') {
        if (typeof telemetry.enabled === 'boolean') {
          config.enabled = telemetry.enabled;
        }
        if (typeof telemetry.maxFileBytes === 'number') {
          config.maxFileBytes = telemetry.maxFileBytes;
        }
        if (typeof telemetry.maxArchiveDays === 'number') {
          config.maxArchiveDays = telemetry.maxArchiveDays;
        }
      }
    } catch {
      // Silently fall back to defaults
    }
  }

  return config;
}

/**
 * Returns true if telemetry is enabled for the given directory.
 */
export function isTelemetryEnabled(directory: string): boolean {
  return loadTelemetryConfig(directory).enabled;
}

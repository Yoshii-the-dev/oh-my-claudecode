/**
 * `omc telemetry digest` — generate a daily telemetry digest on demand.
 *
 * Runs aggregate({ trigger: 'on-demand', directory }) and prints the digest path.
 * Digest is written to .omc/telemetry/digests/daily/<YYYY-MM-DD>.md.
 */
export interface TelemetryDigestOptions {
    /** Project root directory. Defaults to process.cwd(). */
    directory?: string;
}
/**
 * Run the telemetry digest aggregator on demand.
 * Prints the resulting digest path to stdout.
 */
export declare function telemetryDigestCommand(options?: TelemetryDigestOptions): Promise<void>;
//# sourceMappingURL=telemetry.d.ts.map
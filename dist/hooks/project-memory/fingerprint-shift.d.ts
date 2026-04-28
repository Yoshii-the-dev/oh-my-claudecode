/**
 * Project Fingerprint Shift Detection
 *
 * When a project's marker files (package.json, tsconfig, lockfiles, top-level
 * dirs) change between sessions, learned data in `.omc/project-memory.json`
 * is dropped (see detector.ts + index.ts). This module covers the *other*
 * `.omc/**` knowledge artefacts (constitution, competitors, portfolio, specs,
 * etc.) that downstream agents may otherwise treat as factual baseline.
 *
 * Strategy is deliberately conservative: we do not modify those artefacts. We
 * scan which exist, emit a critical-priority `<system-reminder>` warning into
 * the session context, and log the shift to `.omc/.fingerprint-history.json`
 * for audit.
 */
export interface FingerprintShiftEntry {
    previousHash: string | null;
    currentHash: string;
    recordedAt: number;
    staleArtefacts: string[];
}
export interface StaleOmcReport {
    files: string[];
    directories: string[];
    totalCount: number;
}
export declare function scanStaleOmcArtefacts(projectRoot: string): Promise<StaleOmcReport>;
export declare function formatFingerprintShiftWarning(report: StaleOmcReport, previousHashShort: string, currentHashShort: string): string;
export declare function appendFingerprintHistory(projectRoot: string, entry: FingerprintShiftEntry): Promise<void>;
export declare function shortenHash(hash: string | null | undefined): string;
//# sourceMappingURL=fingerprint-shift.d.ts.map
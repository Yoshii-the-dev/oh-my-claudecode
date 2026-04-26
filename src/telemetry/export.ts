/**
 * Telemetry Export — STUB ONLY
 *
 * This interface exists so future opt-in upload work has a clear hook point
 * and contract. Implementation is explicitly out of scope for Phase 1+2
 * (Phase 4, deferred until ≥14 days of telemetry + privacy review).
 *
 * See plan section 11.8.
 */

export type ExportTarget = 'local' | 'cloud-opt-in';

export interface ExportRange {
  from: string;
  to: string;
}

/**
 * STUB. Throws "not implemented" in this segment. Interface exists so future
 * opt-in upload work has a clear hook point and contract.
 *
 * See plan section 11.8; Phase 4 deferred.
 */
export async function exportDigests(_target: ExportTarget, _range: ExportRange): Promise<void> {
  throw new Error('not implemented — see plan section 11.8; Phase 4 deferred');
}

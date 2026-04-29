import type { SummaryPolicyConfig } from '../shared/types.js';
export type SummaryPolicy = Required<SummaryPolicyConfig>;
export declare const DEFAULT_SUMMARY_POLICY: SummaryPolicy;
export declare function normalizeSummaryPolicy(policy?: SummaryPolicyConfig): SummaryPolicy;
export declare function truncateInlineLog(value: string | undefined, policy?: SummaryPolicyConfig): string;
export declare function limitReportLines(value: string, maxLines: number, omittedLabel?: string): string;
export declare function limitFinalReport(value: string, policy?: SummaryPolicyConfig): string;
export declare function limitStageReport(value: string, policy?: SummaryPolicyConfig): string;
//# sourceMappingURL=summary-policy.d.ts.map
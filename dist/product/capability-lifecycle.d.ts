import { type ProductTotalityCapability, type ProductTotalityReport } from './product-totality.js';
import { type ProductScenarioCoverageReport, type ProductScenarioCoverageScenario } from './scenario-coverage.js';
import { type ProductRegressionReport } from './product-regression.js';
export declare const PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH = ".omc/product/capability-lifecycle/current.json";
export declare const PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH = ".omc/product/capability-lifecycle/current.md";
export declare const PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_JSON_RELATIVE_PATH = ".omc/product/capability-lifecycle/history.json";
export declare const PRODUCT_CAPABILITY_LIFECYCLE_HISTORY_MD_RELATIVE_PATH = ".omc/product/capability-lifecycle/history.md";
export type ProductCapabilityLifecycleStatus = 'empty' | 'needs-triage' | 'needs-proof' | 'needs-connection' | 'healthy';
export type ProductCapabilityLifecycleStage = 'seeded' | 'proving' | 'connected' | 'mature' | 'deprecated' | 'remove-candidate';
export type ProductCapabilityLifecycleDecision = 'develop-depth' | 'prove' | 'connect' | 'retain' | 'deprecate' | 'remove-or-redesign';
export type ProductCapabilityLifecycleHistoryEventType = 'observed' | 'stage-transition' | 'decision-change';
export type ProductCapabilityLifecycleTrend = 'new' | 'progressed' | 'regressed' | 'triaged' | 'decision-change' | 'unchanged';
export interface ProductCapabilityLifecycleItem {
    capability_id: string;
    title: string;
    source_cycle: string;
    stage: ProductCapabilityLifecycleStage;
    decision: ProductCapabilityLifecycleDecision;
    maturity: ProductTotalityCapability['maturity'];
    scenario_coverage: ProductScenarioCoverageScenario['coverage'] | 'none';
    connection_count: number;
    missing_depth_count: number;
    regression_debt_count: number;
    error_debt_count: number;
    orphan: boolean;
    reasons: string[];
    recommended_action: string;
    evidence: string[];
}
export interface ProductCapabilityLifecycleReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: ProductCapabilityLifecycleStatus;
    source_artifacts: string[];
    aggregates: {
        capability_count: number;
        seeded: number;
        proving: number;
        connected: number;
        mature: number;
        deprecated: number;
        remove_candidates: number;
        error_debt_capabilities: number;
    };
    capabilities: ProductCapabilityLifecycleItem[];
    next_action: string;
}
export interface ProductCapabilityLifecycleHistoryEvent {
    event_id: string;
    event_type: ProductCapabilityLifecycleHistoryEventType;
    recorded_at: string;
    report_generated_at: string;
    capability_id: string;
    title: string;
    source_cycle: string;
    from_stage?: ProductCapabilityLifecycleStage;
    to_stage: ProductCapabilityLifecycleStage;
    from_decision?: ProductCapabilityLifecycleDecision;
    to_decision: ProductCapabilityLifecycleDecision;
    trend: ProductCapabilityLifecycleTrend;
    reason: string;
    evidence: string[];
}
export interface ProductCapabilityLifecycleHistoryCapability {
    capability_id: string;
    title: string;
    source_cycle: string;
    first_seen_at: string;
    last_seen_at: string;
    previous_stage?: ProductCapabilityLifecycleStage;
    current_stage: ProductCapabilityLifecycleStage;
    current_decision: ProductCapabilityLifecycleDecision;
    transition_path: ProductCapabilityLifecycleStage[];
    event_count: number;
    last_transition?: string;
    trend: ProductCapabilityLifecycleTrend;
}
export interface ProductCapabilityLifecycleHistoryReport {
    schema_version: 1;
    updated_at: string;
    root: string;
    current_report_generated_at: string;
    source_artifacts: string[];
    aggregates: {
        capability_count: number;
        event_count: number;
        transition_count: number;
        progressed_capabilities: number;
        regressed_capabilities: number;
        triaged_capabilities: number;
        new_capabilities: number;
        seeded_current: number;
        proving_current: number;
        connected_current: number;
        mature_current: number;
        remove_candidates_current: number;
        v0_pressure_current: number;
    };
    capabilities: ProductCapabilityLifecycleHistoryCapability[];
    events: ProductCapabilityLifecycleHistoryEvent[];
    next_action: string;
}
export interface ProductCapabilityLifecycleOptions {
    root?: string;
    totality?: ProductTotalityReport;
    scenarioCoverage?: ProductScenarioCoverageReport;
    regression?: ProductRegressionReport;
    now?: Date;
}
export interface ProductCapabilityLifecycleHistoryOptions {
    root?: string;
    current: ProductCapabilityLifecycleReport;
    previous?: ProductCapabilityLifecycleHistoryReport;
    now?: Date;
}
export declare function generateProductCapabilityLifecycleAudit(options?: ProductCapabilityLifecycleOptions): ProductCapabilityLifecycleReport;
export declare function writeProductCapabilityLifecycleAudit(root?: string, report?: ProductCapabilityLifecycleReport, history?: ProductCapabilityLifecycleHistoryReport): {
    jsonPath: string;
    mdPath: string;
    historyJsonPath: string;
    historyMdPath: string;
};
export declare function readProductCapabilityLifecycleHistory(root?: string): ProductCapabilityLifecycleHistoryReport | undefined;
export declare function generateProductCapabilityLifecycleHistory(options: ProductCapabilityLifecycleHistoryOptions): ProductCapabilityLifecycleHistoryReport;
export declare function writeProductCapabilityLifecycleHistory(root: string | undefined, history: ProductCapabilityLifecycleHistoryReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderProductCapabilityLifecycleAudit(report: ProductCapabilityLifecycleReport): string;
export declare function renderProductCapabilityLifecycleHistory(report: ProductCapabilityLifecycleHistoryReport): string;
//# sourceMappingURL=capability-lifecycle.d.ts.map
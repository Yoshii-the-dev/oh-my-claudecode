import { type ProductTotalityCapability, type ProductTotalityReport } from './product-totality.js';
import { type ProductScenarioCoverageReport, type ProductScenarioCoverageScenario } from './scenario-coverage.js';
import { type ProductRegressionReport } from './product-regression.js';
export declare const PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH = ".omc/product/capability-lifecycle/current.json";
export declare const PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH = ".omc/product/capability-lifecycle/current.md";
export type ProductCapabilityLifecycleStatus = 'empty' | 'needs-triage' | 'needs-proof' | 'needs-connection' | 'healthy';
export type ProductCapabilityLifecycleStage = 'seeded' | 'proving' | 'connected' | 'mature' | 'deprecated' | 'remove-candidate';
export type ProductCapabilityLifecycleDecision = 'develop-depth' | 'prove' | 'connect' | 'retain' | 'deprecate' | 'remove-or-redesign';
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
export interface ProductCapabilityLifecycleOptions {
    root?: string;
    totality?: ProductTotalityReport;
    scenarioCoverage?: ProductScenarioCoverageReport;
    regression?: ProductRegressionReport;
    now?: Date;
}
export declare function generateProductCapabilityLifecycleAudit(options?: ProductCapabilityLifecycleOptions): ProductCapabilityLifecycleReport;
export declare function writeProductCapabilityLifecycleAudit(root?: string, report?: ProductCapabilityLifecycleReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderProductCapabilityLifecycleAudit(report: ProductCapabilityLifecycleReport): string;
//# sourceMappingURL=capability-lifecycle.d.ts.map
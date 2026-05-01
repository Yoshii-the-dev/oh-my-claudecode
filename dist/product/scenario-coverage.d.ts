import { type RuntimeQaRunReport } from '../runtime-qa/runner.js';
import { type ProductTotalityReport } from './product-totality.js';
export declare const PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH = ".omc/product/scenario-coverage/current.json";
export declare const PRODUCT_SCENARIO_COVERAGE_MD_RELATIVE_PATH = ".omc/product/scenario-coverage/current.md";
export type ProductScenarioCoverageStatus = 'empty' | 'missing-scenarios' | 'needs-runtime-evidence' | 'runtime-failing' | 'covered';
export type ProductScenarioCoverageLevel = 'missing' | 'declared' | 'runtime-passed' | 'runtime-failed' | 'dry-run' | 'stale';
export interface ProductScenarioCoverageScenario {
    id: string;
    capability_id: string;
    capability_title: string;
    expected_user_loop: string;
    source_cycle: string;
    coverage: ProductScenarioCoverageLevel;
    runtime_qa_status?: RuntimeQaRunReport['status'];
    evidence: string[];
    gaps: string[];
    recommended_action: string;
}
export interface ProductScenarioCoverageGap {
    severity: 'warning' | 'error';
    code: string;
    subject: string;
    message: string;
    recommended_action: string;
}
export interface ProductScenarioCoverageReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: ProductScenarioCoverageStatus;
    source_artifacts: string[];
    aggregates: {
        capability_count: number;
        scenario_count: number;
        covered_scenarios: number;
        declared_scenarios: number;
        missing_scenarios: number;
        failing_scenarios: number;
        stale_scenarios: number;
        runtime_qa_configured: boolean;
        runtime_qa_handoff_exists: boolean;
    };
    scenarios: ProductScenarioCoverageScenario[];
    gaps: ProductScenarioCoverageGap[];
    next_action: string;
}
export interface ProductScenarioCoverageOptions {
    root?: string;
    totality?: ProductTotalityReport;
    now?: Date;
}
export declare function generateProductScenarioCoverageAudit(options?: ProductScenarioCoverageOptions): ProductScenarioCoverageReport;
export declare function writeProductScenarioCoverageAudit(root?: string, report?: ProductScenarioCoverageReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderProductScenarioCoverageAudit(report: ProductScenarioCoverageReport): string;
//# sourceMappingURL=scenario-coverage.d.ts.map
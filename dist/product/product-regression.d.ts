import { type HistoricalScorecardReport } from './historical-scorecard.js';
import { type ProductTotalityReport } from './product-totality.js';
import { type ProductScenarioCoverageReport } from './scenario-coverage.js';
export declare const PRODUCT_REGRESSION_JSON_RELATIVE_PATH = ".omc/product/regression/current.json";
export declare const PRODUCT_REGRESSION_MD_RELATIVE_PATH = ".omc/product/regression/current.md";
export type ProductRegressionStatus = 'empty' | 'needs-repair' | 'needs-scenario-proof' | 'carrying-debt' | 'stable';
export type ProductRegressionDebtCategory = 'learning' | 'capability-depth' | 'orphan' | 'scenario-proof' | 'quality-regression' | 'evidence';
export interface ProductRegressionDebt {
    id: string;
    severity: 'warning' | 'error';
    category: ProductRegressionDebtCategory;
    subject: string;
    source_cycle?: string;
    message: string;
    recommended_action: string;
    evidence: string[];
}
export interface ProductRegressionReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: ProductRegressionStatus;
    source_artifacts: string[];
    aggregates: {
        cycles: number;
        completed_cycles: number;
        regression_debts: number;
        error_debts: number;
        warning_debts: number;
        scenario_proof_debts: number;
        learning_debts: number;
    };
    debts: ProductRegressionDebt[];
    next_action: string;
}
export interface ProductRegressionOptions {
    root?: string;
    totality?: ProductTotalityReport;
    scenarioCoverage?: ProductScenarioCoverageReport;
    historical?: HistoricalScorecardReport;
    now?: Date;
}
export declare function generateProductRegressionAudit(options?: ProductRegressionOptions): ProductRegressionReport;
export declare function writeProductRegressionAudit(root?: string, report?: ProductRegressionReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderProductRegressionAudit(report: ProductRegressionReport): string;
//# sourceMappingURL=product-regression.d.ts.map
import { type ProductCapabilityGraphSnapshot } from './capability-graph.js';
export declare const PRODUCT_TOTALITY_JSON_RELATIVE_PATH = ".omc/product/totality/current.json";
export declare const PRODUCT_TOTALITY_MD_RELATIVE_PATH = ".omc/product/totality/current.md";
export type ProductTotalityStatus = 'empty' | 'under-composed' | 'under-connected' | 'needs-depth' | 'balanced';
export type ProductTotalityMaturity = 'missing-expectation' | 'seeded-v0' | 'contextual-v1' | 'systemic-v2';
export interface ProductTotalityScore {
    value: number;
    status: 'good' | 'warn' | 'bad' | 'unknown';
    detail: string;
}
export interface ProductTotalityCapability {
    id: string;
    title: string;
    source_cycle: string;
    source_path: string;
    maturity: ProductTotalityMaturity;
    user_job?: string;
    first_meaningful_use?: string;
    implemented_as: string;
    missing_depth: string[];
    connections: string[];
    evidence: string[];
    risks: string[];
}
export interface ProductTotalityGap {
    severity: 'warning' | 'error';
    code: string;
    subject: string;
    message: string;
    recommended_action: string;
}
export interface ProductTotalityRecommendedMove {
    id: string;
    title: string;
    lane: 'product' | 'ux' | 'research' | 'backend' | 'quality' | 'brand-content' | 'distribution';
    type: 'core-product-slice' | 'enabling' | 'learning' | 'research' | 'quality' | 'distribution';
    why: string;
    evidence: string[];
}
export interface ProductTotalityReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: ProductTotalityStatus;
    source_artifacts: string[];
    aggregates: {
        completed_cycles: number;
        learning_captures: number;
        seeded_capabilities: number;
        supporting_systems: number;
        portfolio_items: number;
        active_or_selected_items: number;
        lanes: string[];
    };
    scores: {
        composition: ProductTotalityScore;
        connectedness: ProductTotalityScore;
        freedom: ProductTotalityScore;
        depth: ProductTotalityScore;
        complexity_fit: ProductTotalityScore;
        beauty_fit: ProductTotalityScore;
    };
    capability_graph: ProductCapabilityGraphSnapshot;
    capabilities: ProductTotalityCapability[];
    gaps: ProductTotalityGap[];
    recommended_moves: ProductTotalityRecommendedMove[];
    next_action: string;
}
export declare function generateProductTotalityAudit(root?: string): ProductTotalityReport;
export declare function writeProductTotalityAudit(root?: string, report?: ProductTotalityReport): {
    jsonPath: string;
    mdPath: string;
    capabilityGraphJsonPath: string;
    capabilityGraphMdPath: string;
};
export declare function renderProductTotalityAudit(report: ProductTotalityReport): string;
//# sourceMappingURL=product-totality.d.ts.map
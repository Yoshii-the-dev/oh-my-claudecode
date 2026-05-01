import type { ProductTotalityCapability } from './product-totality.js';
export declare const PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH = ".omc/product/capability-graph/current.json";
export declare const PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH = ".omc/product/capability-graph/current.md";
export type ProductCapabilityGraphNodeKind = 'capability' | 'artifact' | 'portfolio' | 'context' | 'maturity';
export type ProductCapabilityGraphEdgeType = 'learning' | 'portfolio' | 'context' | 'shared-job' | 'shared-depth' | 'maturity-depth';
export interface ProductCapabilityGraphNode {
    id: string;
    kind: ProductCapabilityGraphNodeKind;
    label: string;
    source?: string;
    maturity?: ProductTotalityCapability['maturity'];
    user_job?: string;
    missing_depth_count?: number;
    orphan_score?: number;
}
export interface ProductCapabilityGraphEdge {
    from: string;
    to: string;
    type: ProductCapabilityGraphEdgeType;
    label: string;
    strength: number;
    evidence: string[];
}
export interface ProductCapabilityGraphOrphan {
    capability_id: string;
    title: string;
    severity: 'warning' | 'error';
    score: number;
    reasons: string[];
    recommended_action: string;
    evidence: string[];
}
export interface ProductCapabilityGraphSnapshot {
    aggregates: {
        capability_count: number;
        context_node_count: number;
        edge_count: number;
        capability_edge_count: number;
        orphan_count: number;
        isolated_capability_count: number;
        average_capability_degree: number;
        missing_depth_count: number;
    };
    nodes: ProductCapabilityGraphNode[];
    edges: ProductCapabilityGraphEdge[];
    orphan_capabilities: ProductCapabilityGraphOrphan[];
}
export interface ProductCapabilityGraphReport extends ProductCapabilityGraphSnapshot {
    schema_version: 1;
    generated_at: string;
    root: string;
    source_totality: string;
    source_artifacts: string[];
}
export declare function buildProductCapabilityGraphSnapshot(capabilities: ProductTotalityCapability[]): ProductCapabilityGraphSnapshot;
export declare function writeProductCapabilityGraphAudit(root: string, snapshot: ProductCapabilityGraphSnapshot, metadata: {
    generatedAt: string;
    sourceTotality: string;
    sourceArtifacts: string[];
}): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderProductCapabilityGraph(report: ProductCapabilityGraphReport | ProductCapabilityGraphSnapshot): string;
//# sourceMappingURL=capability-graph.d.ts.map
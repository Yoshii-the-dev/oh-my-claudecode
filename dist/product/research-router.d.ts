import type { ProductCycleSnapshot, ProductCycleStage } from './cycle-fsm.js';
export type ProductResearchAgent = 'researcher' | 'dependency-expert' | 'ux-researcher' | 'designer' | 'product-manager' | 'product-analyst' | 'architect' | 'security-reviewer' | 'performance-reviewer';
export interface ProductResearchRoute {
    id: string;
    agent: ProductResearchAgent;
    trigger: string;
    purpose: string;
    required: boolean;
    command: string;
    blocksStage: boolean;
    evidence: string[];
    expectedArtifact: string;
}
export interface ProductResearchPlan {
    stage: ProductCycleStage;
    routes: ProductResearchRoute[];
    blockingRoutes: ProductResearchRoute[];
    nextCommand?: string;
}
export interface ProductResearchHandoff {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-research-router';
    cycle_id?: string;
    cycle_goal?: string;
    cycle_stage: ProductCycleStage;
    status: 'blocked' | 'ready';
    next_command?: string;
    routes: ProductResearchRoute[];
    blocking_route_count: number;
    research_artifact: string;
    context_consumed: string[];
}
export interface ProductResearchHandoffWriteResult {
    jsonPath: string;
    mdPath: string;
}
export interface PlanProductResearchOptions {
    root?: string;
    stage: ProductCycleStage;
    snapshot: ProductCycleSnapshot;
}
export declare const PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH = ".omc/handoffs/product-cycle-research/current.json";
export declare const PRODUCT_RESEARCH_ARTIFACT_RELATIVE_PATH = ".omc/research/product-cycle/current.md";
export declare function planProductResearch(options: PlanProductResearchOptions): ProductResearchPlan;
export declare function writeProductResearchHandoff(root: string, snapshot: ProductCycleSnapshot, plan: ProductResearchPlan): ProductResearchHandoffWriteResult;
export declare function readProductResearchHandoff(root?: string): ProductResearchHandoff | undefined;
//# sourceMappingURL=research-router.d.ts.map
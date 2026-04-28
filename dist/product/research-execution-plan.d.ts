import type { ProductResearchHandoff, ProductResearchRoute } from './research-router.js';
export type ProductResearchExecutionSurface = 'agent-prompt' | 'manual';
export interface ProductResearchExecutionStep {
    route_id: string;
    agent: ProductResearchRoute['agent'];
    source_command: string;
    execution_surface: ProductResearchExecutionSurface;
    executable: boolean;
    review_required: boolean;
    reason: string;
    expected_artifact: string;
    argv?: string[];
}
export interface ProductResearchExecutionPlan {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-research-execution-planner';
    source_handoff: string;
    cycle_id?: string;
    cycle_goal?: string;
    cycle_stage: ProductResearchHandoff['cycle_stage'];
    provider: string;
    research_artifact: string;
    steps: ProductResearchExecutionStep[];
    executable_step_count: number;
    manual_step_count: number;
    next_argv?: string[];
}
export interface ProductResearchExecutionPlanWriteResult {
    jsonPath: string;
    mdPath: string;
}
export interface BuildProductResearchExecutionPlanOptions {
    provider?: string;
    sourceHandoff?: string;
}
export declare const PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH = ".omc/handoffs/product-cycle-research/execution-plan.json";
export declare function buildProductResearchExecutionPlan(handoff: ProductResearchHandoff, options?: BuildProductResearchExecutionPlanOptions): ProductResearchExecutionPlan;
export declare function writeProductResearchExecutionPlan(root: string, plan: ProductResearchExecutionPlan): ProductResearchExecutionPlanWriteResult;
export declare function readProductResearchExecutionPlan(root?: string): ProductResearchExecutionPlan | undefined;
export declare function renderProductResearchExecutionPlan(plan: ProductResearchExecutionPlan): string;
//# sourceMappingURL=research-execution-plan.d.ts.map
import type { ProductInterventionHandoff, ProductInterventionRoute } from './intervention-router.js';
export type ProductInterventionExecutionSurface = 'agent-prompt' | 'stack-plan' | 'team-start' | 'slash-skill' | 'manual';
export interface ProductInterventionExecutionStep {
    route_id: string;
    agent: ProductInterventionRoute['agent'];
    source_command: string;
    execution_surface: ProductInterventionExecutionSurface;
    executable: boolean;
    review_required: boolean;
    reason: string;
    argv?: string[];
}
export interface ProductInterventionExecutionPlan {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-intervention-execution-planner';
    source_handoff: string;
    cycle_id?: string;
    cycle_goal?: string;
    cycle_stage: ProductInterventionHandoff['cycle_stage'];
    provider: string;
    steps: ProductInterventionExecutionStep[];
    executable_step_count: number;
    review_required_step_count: number;
    manual_step_count: number;
    next_argv?: string[];
}
export interface ProductInterventionExecutionPlanWriteResult {
    jsonPath: string;
    mdPath: string;
}
export interface BuildProductInterventionExecutionPlanOptions {
    provider?: string;
    sourceHandoff?: string;
}
export declare const PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH = ".omc/handoffs/product-cycle-interventions/execution-plan.json";
export declare function buildProductInterventionExecutionPlan(handoff: ProductInterventionHandoff, options?: BuildProductInterventionExecutionPlanOptions): ProductInterventionExecutionPlan;
export declare function writeProductInterventionExecutionPlan(root: string, plan: ProductInterventionExecutionPlan): ProductInterventionExecutionPlanWriteResult;
export declare function readProductInterventionExecutionPlan(root?: string): ProductInterventionExecutionPlan | undefined;
export declare function renderProductInterventionExecutionPlan(plan: ProductInterventionExecutionPlan): string;
//# sourceMappingURL=intervention-execution-plan.d.ts.map
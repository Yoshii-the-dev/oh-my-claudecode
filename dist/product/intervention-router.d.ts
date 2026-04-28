import type { ProductCycleSnapshot, ProductCycleStage } from './cycle-fsm.js';
export type ProductInterventionAgent = 'product-foundation' | 'priority-engine' | 'product-experience-gate' | 'stack-provision' | 'backend-pipeline' | 'product-pipeline' | 'debugger' | 'executor' | 'test-engineer' | 'verifier' | 'ux-architect' | 'designer' | 'qa-tester';
export interface ProductInterventionRoute {
    id: string;
    agent: ProductInterventionAgent;
    trigger: string;
    purpose: string;
    required: boolean;
    command: string;
    blocksStage: boolean;
    evidence?: string[];
}
export interface ProductInterventionPlan {
    stage: ProductCycleStage;
    routes: ProductInterventionRoute[];
    blockingRoutes: ProductInterventionRoute[];
    nextCommand?: string;
}
export interface ProductInterventionHandoff {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-intervention-router';
    cycle_id?: string;
    cycle_goal?: string;
    cycle_stage: ProductCycleStage;
    status: 'blocked' | 'ready';
    next_command?: string;
    routes: ProductInterventionRoute[];
    blocking_route_count: number;
    context_consumed: string[];
}
export interface ProductInterventionHandoffWriteResult {
    jsonPath: string;
    mdPath: string;
}
export declare const PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH = ".omc/handoffs/product-cycle-interventions/current.json";
export interface PlanProductInterventionsOptions {
    root?: string;
    stage: ProductCycleStage;
    snapshot: ProductCycleSnapshot;
    failure?: {
        kind: 'verify-command-failed' | 'contract-failed';
        command?: string;
        reason?: string;
    };
}
export declare function planProductInterventions(options: PlanProductInterventionsOptions): ProductInterventionPlan;
export declare function writeProductInterventionHandoff(root: string, snapshot: ProductCycleSnapshot, plan: ProductInterventionPlan): ProductInterventionHandoffWriteResult;
export declare function readProductInterventionHandoff(root?: string): ProductInterventionHandoff | undefined;
//# sourceMappingURL=intervention-router.d.ts.map
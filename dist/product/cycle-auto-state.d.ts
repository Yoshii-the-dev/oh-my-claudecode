import type { ProductCycleStage } from './cycle-fsm.js';
import type { ProductCycleAutoPolicy } from './auto-decision.js';
export declare const PRODUCT_CYCLE_AUTO_STATE_RELATIVE_PATH = ".omc/state/product-cycle-state.json";
export interface ProductCycleAutoState {
    mode: 'product-cycle';
    active: boolean;
    auto_policy: ProductCycleAutoPolicy;
    started_at: string;
    updated_at: string;
    completed_at?: string;
    session_id?: string;
    root: string;
    cycle_id?: string;
    cycle_goal?: string;
    cycle_stage?: ProductCycleStage;
    stopped_reason?: string;
    last_decision?: {
        action: string;
        reason: string;
        message: string;
    };
    attempt_counts: Record<string, number>;
}
export declare function readProductCycleAutoState(root?: string): ProductCycleAutoState | undefined;
export declare function writeProductCycleAutoState(root: string, state: ProductCycleAutoState): ProductCycleAutoState;
export declare function startProductCycleAutoState(options: {
    root: string;
    autoPolicy: ProductCycleAutoPolicy;
    sessionId?: string;
    cycleId?: string;
    cycleGoal?: string;
    cycleStage?: ProductCycleStage;
}): ProductCycleAutoState;
export declare function updateProductCycleAutoState(root: string, patch: Partial<Omit<ProductCycleAutoState, 'mode' | 'root' | 'attempt_counts'>> & {
    attempt_counts?: Record<string, number>;
}): ProductCycleAutoState;
export declare function incrementProductCycleAutoAttempt(root: string, key: string): number;
//# sourceMappingURL=cycle-auto-state.d.ts.map
export type ProductCycleStage = 'discover' | 'rank' | 'select' | 'spec' | 'build' | 'verify' | 'learn' | 'complete' | 'blocked';
export interface ProductCycleIssue {
    severity: 'error' | 'warning';
    code: string;
    message: string;
}
export interface ProductCycleSnapshot {
    exists: boolean;
    root: string;
    path: string;
    cycleId?: string;
    cycleGoal?: string;
    stage?: ProductCycleStage;
    productStage?: string;
    buildRoute?: string;
    nextStage?: ProductCycleStage;
    nextAction: string;
    issues: ProductCycleIssue[];
}
export interface ProductCycleAdvanceResult {
    ok: boolean;
    from?: ProductCycleStage;
    to: ProductCycleStage;
    snapshot: ProductCycleSnapshot;
    issues: ProductCycleIssue[];
}
export interface AdvanceProductCycleOptions {
    root?: string;
    to: ProductCycleStage;
    goal?: string;
    force?: boolean;
}
export declare function isProductCycleStage(value: string): value is ProductCycleStage;
export declare function getProductCyclePath(root?: string): string;
export declare function readProductCycle(root?: string): ProductCycleSnapshot;
export declare function validateProductCycle(root?: string): ProductCycleSnapshot;
export declare function advanceProductCycle(options: AdvanceProductCycleOptions): ProductCycleAdvanceResult;
export declare function getNextProductCycleAction(root?: string): ProductCycleSnapshot;
//# sourceMappingURL=cycle-fsm.d.ts.map
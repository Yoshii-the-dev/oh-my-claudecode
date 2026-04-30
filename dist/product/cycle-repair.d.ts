export type ProductCycleRepairStatus = 'passed' | 'changed' | 'needed' | 'skipped' | 'blocked';
export interface ProductCycleRepairAction {
    id: string;
    status: ProductCycleRepairStatus;
    path?: string;
    message: string;
    command?: string;
}
export interface ProductCycleRepairReport {
    ok: boolean;
    root: string;
    safe: boolean;
    actions: ProductCycleRepairAction[];
    summary: {
        passed: number;
        changed: number;
        needed: number;
        skipped: number;
        blocked: number;
    };
}
export interface ProductCycleRepairOptions {
    safe?: boolean;
}
export declare function repairProductCycle(root?: string, options?: ProductCycleRepairOptions): ProductCycleRepairReport;
//# sourceMappingURL=cycle-repair.d.ts.map
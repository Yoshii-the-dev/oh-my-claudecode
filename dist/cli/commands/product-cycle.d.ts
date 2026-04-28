/**
 * `omc product-cycle` — runtime FSM for the product learning loop.
 */
import { type ProductInterventionCommandRunner } from '../../product/intervention-runner.js';
export interface ProductCycleCommandOptions {
    json?: boolean;
    to?: string;
    goal?: string;
    force?: boolean;
    maxStages?: number;
    stopAt?: string;
    dryRun?: boolean;
    verifyCommand?: string;
    provider?: string;
    maxSteps?: number;
    wait?: boolean;
    waitTimeoutMs?: number;
    resumeCycle?: boolean;
    autoBuild?: boolean;
    interventionCommandRunner?: ProductInterventionCommandRunner;
}
interface LoggerLike {
    log: (message?: unknown) => void;
    error: (message?: unknown) => void;
}
export declare function productCycleStatusCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleNextCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleValidateCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleAdvanceCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleRunCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleInterventionsCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleInterventionsPlanCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleInterventionsRunCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleResearchCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleResearchPlanCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function productCycleResearchRunCommand(root: string | undefined, options: ProductCycleCommandOptions, logger?: LoggerLike): Promise<number>;
export {};
//# sourceMappingURL=product-cycle.d.ts.map
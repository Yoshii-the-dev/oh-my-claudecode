/**
 * `omc product-regression` — cross-cycle regression and learning debt audit.
 */
import { type ProductRegressionReport } from '../../product/product-regression.js';
export interface ProductRegressionCommandOptions {
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function productRegressionAuditCommand(root: string | undefined, options: ProductRegressionCommandOptions, logger?: LoggerLike): Promise<number>;
export type { ProductRegressionReport };
//# sourceMappingURL=product-regression.d.ts.map
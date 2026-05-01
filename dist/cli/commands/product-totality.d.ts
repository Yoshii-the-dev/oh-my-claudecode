/**
 * `omc product-totality` — aggregate completed product work and missing depth.
 */
import { type ProductTotalityReport } from '../../product/product-totality.js';
export interface ProductTotalityCommandOptions {
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function productTotalityAuditCommand(root: string | undefined, options: ProductTotalityCommandOptions, logger?: LoggerLike): Promise<number>;
export type { ProductTotalityReport };
//# sourceMappingURL=product-totality.d.ts.map
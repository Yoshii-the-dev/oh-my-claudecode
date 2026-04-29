/**
 * `omc feature-generation` — source/MCP readiness for product idea generation.
 */
import { renderFeatureGenerationPlan } from '../../product/feature-generation.js';
export interface FeatureGenerationCommandOptions {
    goal?: string;
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
    error: (message?: unknown) => void;
}
export declare function featureGenerationAuditCommand(root: string | undefined, options: FeatureGenerationCommandOptions, logger?: LoggerLike): Promise<number>;
export { renderFeatureGenerationPlan };
//# sourceMappingURL=feature-generation.d.ts.map
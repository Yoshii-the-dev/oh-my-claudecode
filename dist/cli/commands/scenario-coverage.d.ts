/**
 * `omc scenario-coverage` — map product capabilities to executable user-loop evidence.
 */
import { type ProductScenarioCoverageReport } from '../../product/scenario-coverage.js';
export interface ScenarioCoverageCommandOptions {
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function scenarioCoverageAuditCommand(root: string | undefined, options: ScenarioCoverageCommandOptions, logger?: LoggerLike): Promise<number>;
export type { ProductScenarioCoverageReport };
//# sourceMappingURL=scenario-coverage.d.ts.map
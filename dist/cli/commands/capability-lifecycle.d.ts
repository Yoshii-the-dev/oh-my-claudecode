/**
 * `omc capability-lifecycle` — classify completed capabilities into lifecycle stages.
 */
import { type ProductCapabilityLifecycleReport } from '../../product/capability-lifecycle.js';
export interface CapabilityLifecycleCommandOptions {
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function capabilityLifecycleAuditCommand(root: string | undefined, options: CapabilityLifecycleCommandOptions, logger?: LoggerLike): Promise<number>;
export type { ProductCapabilityLifecycleReport };
//# sourceMappingURL=capability-lifecycle.d.ts.map
/**
 * `omc creative-loop` — UI/UX creative loop artifact checks.
 */
import { renderCreativeLoopPlan } from '../../product/creative-loop.js';
export interface CreativeLoopCommandOptions {
    goal?: string;
    json?: boolean;
    write?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function creativeLoopAuditCommand(root: string | undefined, options: CreativeLoopCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function creativeLoopInitCommand(root: string | undefined, options: CreativeLoopCommandOptions, logger?: LoggerLike): Promise<number>;
export { renderCreativeLoopPlan };
//# sourceMappingURL=creative-loop.d.ts.map
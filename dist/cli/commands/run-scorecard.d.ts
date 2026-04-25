/**
 * `omc run-scorecard` — product/agent pipeline quality metrics.
 */
import { type RunScorecardReport } from '../../product/run-scorecard.js';
export interface RunScorecardCommandOptions {
    json?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function runScorecardCommand(root: string | undefined, options: RunScorecardCommandOptions, logger?: LoggerLike): Promise<RunScorecardReport>;
export {};
//# sourceMappingURL=run-scorecard.d.ts.map
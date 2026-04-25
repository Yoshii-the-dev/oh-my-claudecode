/**
 * `omc historical-scorecard` — compare run quality between cycles.
 */
import { type HistoricalScorecardReport } from '../../product/historical-scorecard.js';
export interface HistoricalScorecardCommandOptions {
    json?: boolean;
}
export declare function historicalScorecardCommand(root: string | undefined, options: HistoricalScorecardCommandOptions, logger?: Console): Promise<number>;
export type { HistoricalScorecardReport };
//# sourceMappingURL=historical-scorecard.d.ts.map
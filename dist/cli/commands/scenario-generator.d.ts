/**
 * `omc scenario-generator` — derive user-loop scenarios from feature expectation contracts.
 */
import { type ProductScenarioGenerationReport } from '../../product/scenario-generator.js';
export interface ScenarioGeneratorCommandOptions {
    json?: boolean;
    write?: boolean;
    applyRuntimeQa?: boolean;
    runRuntimeQa?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function scenarioGeneratorCommand(root: string | undefined, options: ScenarioGeneratorCommandOptions, logger?: LoggerLike): Promise<number>;
export type { ProductScenarioGenerationReport };
//# sourceMappingURL=scenario-generator.d.ts.map
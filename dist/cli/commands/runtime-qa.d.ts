import { type RuntimeQaCommandRunner } from '../../runtime-qa/runner.js';
export interface RuntimeQaCommandOptions {
    auto?: boolean;
    dryRun?: boolean;
    json?: boolean;
    installMobileTools?: boolean;
    target?: string;
    write?: boolean;
    force?: boolean;
    commandRunner?: RuntimeQaCommandRunner;
}
interface LoggerLike {
    log: (message?: unknown) => void;
    error: (message?: unknown) => void;
}
export declare function runtimeQaRunCommand(root: string | undefined, options: RuntimeQaCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function runtimeQaInitCommand(root: string | undefined, options: RuntimeQaCommandOptions, logger?: LoggerLike): Promise<number>;
export {};
//# sourceMappingURL=runtime-qa.d.ts.map
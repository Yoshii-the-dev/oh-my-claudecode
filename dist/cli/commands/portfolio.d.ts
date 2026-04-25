/**
 * `omc portfolio` — machine-readable product portfolio ledger helpers.
 */
export interface PortfolioCommandOptions {
    json?: boolean;
    write?: boolean;
    output?: string;
    source?: string;
    force?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
    error: (message?: unknown) => void;
}
export declare function portfolioValidateCommand(root: string | undefined, options: PortfolioCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function portfolioProjectCommand(root: string | undefined, options: PortfolioCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function portfolioMigrateCommand(root: string | undefined, options: PortfolioCommandOptions, logger?: LoggerLike): Promise<number>;
export {};
//# sourceMappingURL=portfolio.d.ts.map
/**
 * `omc state-hygiene` — find and optionally untrack runtime .omc state.
 */
export interface StateHygieneCommandOptions {
    apply?: boolean;
    json?: boolean;
}
export interface StateHygieneReport {
    ok: boolean;
    root: string;
    gitRoot: string | null;
    applied: boolean;
    trackedRuntimeFileCount: number;
    trackedRuntimeFiles: string[];
    issues: Array<{
        severity: 'error' | 'warning';
        code: string;
        message: string;
    }>;
}
interface LoggerLike {
    log: (message?: unknown) => void;
    error: (message?: unknown) => void;
}
export declare function stateHygieneCommand(root: string | undefined, options: StateHygieneCommandOptions, logger?: LoggerLike): Promise<number>;
export declare function runStateHygiene(root: string | undefined, options?: Pick<StateHygieneCommandOptions, 'apply'>): StateHygieneReport;
export declare function inspectStateHygiene(root: string | undefined): StateHygieneReport;
export declare function isOmcRuntimeStatePath(path: string): boolean;
export {};
//# sourceMappingURL=state-hygiene.d.ts.map
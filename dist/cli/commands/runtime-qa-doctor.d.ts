/**
 * `omc doctor runtime-qa` — read-only runtime QA readiness and evidence checks.
 */
export interface RuntimeQaDoctorCommandOptions {
    json?: boolean;
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function runtimeQaDoctorCommand(root: string | undefined, options: RuntimeQaDoctorCommandOptions, logger?: LoggerLike): Promise<number>;
export {};
//# sourceMappingURL=runtime-qa-doctor.d.ts.map
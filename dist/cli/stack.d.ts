/**
 * `omc stack` — CLI wrapper around skills/stack-provision/scripts/orchestrate.mjs.
 *
 * Phase 1 thin wrapper. Defaults to headless mode (CLI is the scripting path;
 * the chat slash command is the interactive path). Pretty-prints orchestrator
 * JSON events for humans, or pipes raw JSON when stdout is not a TTY (machine
 * consumers).
 */
export declare const STACK_USAGE: string;
interface ParsedCli {
    subcommand: 'run' | 'plan' | 'apply' | 'help';
    positional: string[];
    raw: boolean;
    forwardArgs: string[];
}
declare function parseCli(argv: string[]): ParsedCli;
declare function resolveOrchestratorPath(packageRoot: string): string;
interface OrchestratorEvent {
    ts?: number;
    event: string;
    [key: string]: unknown;
}
declare function prettyEvent(evt: OrchestratorEvent): string | null;
declare function buildOrchestratorArgs(parsed: ParsedCli): {
    args: string[];
    explicitMode?: 'plan' | 'apply';
};
export declare function stackCommand(argv: string[]): Promise<void>;
export declare const __testing: {
    parseCli: typeof parseCli;
    prettyEvent: typeof prettyEvent;
    buildOrchestratorArgs: typeof buildOrchestratorArgs;
    resolveOrchestratorPath: typeof resolveOrchestratorPath;
};
export {};
//# sourceMappingURL=stack.d.ts.map
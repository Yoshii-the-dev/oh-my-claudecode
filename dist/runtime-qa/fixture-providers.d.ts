import type { RuntimeQaFixtureConfig } from './runner.js';
export type RuntimeQaFixtureProvider = 'supabase';
export type RuntimeQaFixtureProviderBackend = 'auto' | 'env' | 'mcp';
export type RuntimeQaFixtureStrategy = 'auth-admin-user';
export type RuntimeQaFixtureAction = 'provision' | 'teardown';
export interface RuntimeQaFixtureProviderResolution {
    supported: boolean;
    provider?: RuntimeQaFixtureProvider;
    strategy?: RuntimeQaFixtureStrategy;
    requestedBackend?: RuntimeQaFixtureProviderBackend;
    backend?: RuntimeQaFixtureProviderBackend;
    available: boolean;
    requiresAgentMcp?: boolean;
    provisionCommand?: string;
    teardownCommand?: string;
    envFile?: string;
    reason: string;
}
export interface RuntimeQaFixtureProvisionResult {
    root: string;
    fixture: string;
    provider: RuntimeQaFixtureProvider;
    backend: RuntimeQaFixtureProviderBackend;
    action: RuntimeQaFixtureAction;
    ok: boolean;
    statePath: string;
    envPath: string;
    userId?: string;
    email?: string;
    agent_action?: RuntimeQaFixtureAgentAction;
    reason: string;
}
export interface RuntimeQaFixtureAgentAction {
    kind: 'supabase-auth-admin-user';
    transport: 'claude-mcp';
    action: RuntimeQaFixtureAction;
    fixture: string;
    statePath: string;
    envPath: string;
    required_env: {
        email: string;
        password: string;
        user_id: string;
    };
    safety: string[];
    instructions: string[];
}
export declare function resolveFixtureProvider(root: string, fixtureName: string, fixture: RuntimeQaFixtureConfig | undefined): RuntimeQaFixtureProviderResolution;
export declare function provisionRuntimeQaFixture(options: {
    root?: string;
    fixtureName: string;
    backend?: RuntimeQaFixtureProviderBackend;
}): Promise<RuntimeQaFixtureProvisionResult>;
export declare function teardownRuntimeQaFixture(options: {
    root?: string;
    fixtureName: string;
    backend?: RuntimeQaFixtureProviderBackend;
}): Promise<RuntimeQaFixtureProvisionResult>;
export declare function wrapCommandWithFixtureEnv(fixtureName: string, command: string): string;
export declare function providerLifecycleCommands(fixtureName: string): {
    provisionCommand: string;
    teardownCommand: string;
};
export declare function fixtureEnvFileRelative(fixtureName: string): string;
//# sourceMappingURL=fixture-providers.d.ts.map
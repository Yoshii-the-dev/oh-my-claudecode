import { randomBytes } from 'crypto';
import { existsSync, readFileSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import type { RuntimeQaConfig, RuntimeQaFixtureConfig } from './runner.js';

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

interface RuntimeQaFixtureState {
  provider: RuntimeQaFixtureProvider;
  strategy: RuntimeQaFixtureStrategy;
  backend: RuntimeQaFixtureProviderBackend;
  user_id: string;
  email: string;
  password: string;
  created_at: string;
}

interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
}

const RUNTIME_QA_RUNTIME_DIR = '.omc/runtime-qa';
const RUNTIME_QA_CONFIG_RELATIVE_PATH = '.omc/runtime-qa.json';

export function resolveFixtureProvider(
  root: string,
  fixtureName: string,
  fixture: RuntimeQaFixtureConfig | undefined,
): RuntimeQaFixtureProviderResolution {
  if (!fixture?.provider) {
    return {
      supported: false,
      available: false,
      reason: 'Fixture does not declare a provider.',
    };
  }

  if (fixture.provider !== 'supabase' || fixture.strategy !== 'auth-admin-user') {
    return {
      supported: false,
      provider: fixture.provider,
      strategy: fixture.strategy,
      requestedBackend: fixture.backend,
      available: false,
      reason: `Unsupported runtime QA fixture provider ${fixture.provider}/${fixture.strategy}.`,
    };
  }

  const backend = resolveSupabaseBackend(root, fixture.backend ?? 'auto');
  const commands = providerLifecycleCommands(fixtureName);
  return {
    supported: true,
    provider: 'supabase',
    strategy: 'auth-admin-user',
    requestedBackend: fixture.backend ?? 'auto',
    backend: backend.backend,
    available: backend.available,
    requiresAgentMcp: backend.requiresAgentMcp,
    provisionCommand: commands.provisionCommand,
    teardownCommand: commands.teardownCommand,
    envFile: fixtureEnvFileRelative(fixtureName),
    reason: backend.reason,
  };
}

export async function provisionRuntimeQaFixture(options: {
  root?: string;
  fixtureName: string;
  backend?: RuntimeQaFixtureProviderBackend;
}): Promise<RuntimeQaFixtureProvisionResult> {
  const root = resolve(options.root ?? process.cwd());
  const fixture = readRuntimeQaFixtureConfig(root, options.fixtureName);
  assertSupportedSupabaseFixture(options.fixtureName, fixture);
  const backend = resolveSupabaseBackend(root, options.backend ?? fixture.backend ?? 'auto');
  if (backend.backend === 'mcp') {
    return unsupportedMcpResult(root, options.fixtureName, 'provision', backend.reason);
  }
  if (!backend.available) {
    return failedFixtureResult(root, options.fixtureName, 'provision', backend.backend, backend.reason);
  }

  const env = readRuntimeQaEnv(root);
  const supabaseEnv = requireSupabaseEnv(env);
  const previousState = readFixtureState(root, options.fixtureName);
  if (previousState?.user_id) {
    await deleteSupabaseUser(supabaseEnv, previousState.user_id);
  }

  const runId = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const emailPrefix = fixture.email_prefix ?? `runtime-qa-${toKebabCase(options.fixtureName)}`;
  const email = `${emailPrefix}+${runId}-${randomToken(4)}@example.com`;
  const password = `OMC-rqa-${randomToken(18)}1!`;
  const user = await createSupabaseUser(supabaseEnv, {
    email,
    password,
    fixtureName: options.fixtureName,
    runId,
  });
  const paths = fixtureStatePaths(root, options.fixtureName);
  const state: RuntimeQaFixtureState = {
    provider: 'supabase',
    strategy: 'auth-admin-user',
    backend: 'env',
    user_id: user.id,
    email,
    password,
    created_at: new Date().toISOString(),
  };
  ensureDirSync(dirname(paths.statePath));
  atomicWriteJsonSync(paths.statePath, state);
  atomicWriteFileSync(paths.envPath, renderFixtureEnv(options.fixtureName, state, fixture));

  return {
    root,
    fixture: options.fixtureName,
    provider: 'supabase',
    backend: 'env',
    action: 'provision',
    ok: true,
    statePath: paths.statePath,
    envPath: paths.envPath,
    userId: user.id,
    email,
    reason: 'Supabase disposable auth user provisioned.',
  };
}

export async function teardownRuntimeQaFixture(options: {
  root?: string;
  fixtureName: string;
  backend?: RuntimeQaFixtureProviderBackend;
}): Promise<RuntimeQaFixtureProvisionResult> {
  const root = resolve(options.root ?? process.cwd());
  const fixture = readRuntimeQaFixtureConfig(root, options.fixtureName);
  assertSupportedSupabaseFixture(options.fixtureName, fixture);
  const backend = resolveSupabaseBackend(root, options.backend ?? fixture.backend ?? 'auto');
  if (backend.backend === 'mcp') {
    return unsupportedMcpResult(root, options.fixtureName, 'teardown', backend.reason);
  }
  const paths = fixtureStatePaths(root, options.fixtureName);
  const state = readFixtureState(root, options.fixtureName);
  if (!state?.user_id) {
    rmSync(paths.envPath, { force: true });
    return {
      root,
      fixture: options.fixtureName,
      provider: 'supabase',
      backend: backend.backend,
      action: 'teardown',
      ok: true,
      statePath: paths.statePath,
      envPath: paths.envPath,
      reason: 'No Supabase disposable auth user state found; teardown skipped.',
    };
  }
  if (!backend.available) {
    return failedFixtureResult(root, options.fixtureName, 'teardown', backend.backend, backend.reason);
  }
  const env = readRuntimeQaEnv(root);
  await deleteSupabaseUser(requireSupabaseEnv(env), state.user_id);
  rmSync(paths.statePath, { force: true });
  rmSync(paths.envPath, { force: true });
  return {
    root,
    fixture: options.fixtureName,
    provider: 'supabase',
    backend: 'env',
    action: 'teardown',
    ok: true,
    statePath: paths.statePath,
    envPath: paths.envPath,
    userId: state.user_id,
    email: state.email,
    reason: 'Supabase disposable auth user torn down.',
  };
}

export function wrapCommandWithFixtureEnv(
  fixtureName: string,
  command: string,
): string {
  const envFile = fixtureEnvFileRelative(fixtureName);
  return `set -a; . ${shellQuote(envFile)}; set +a; ${command}`;
}

export function providerLifecycleCommands(fixtureName: string): {
  provisionCommand: string;
  teardownCommand: string;
} {
  return {
    provisionCommand: `omc runtime-qa fixture provision ${shellQuote(fixtureName)}`,
    teardownCommand: `omc runtime-qa fixture teardown ${shellQuote(fixtureName)}`,
  };
}

export function fixtureEnvFileRelative(fixtureName: string): string {
  return `${RUNTIME_QA_RUNTIME_DIR}/${sanitizeFixtureName(fixtureName)}.env`;
}

function assertSupportedSupabaseFixture(fixtureName: string, fixture: RuntimeQaFixtureConfig | undefined): asserts fixture is RuntimeQaFixtureConfig {
  if (!fixture) {
    throw new Error(`Runtime QA fixture ${fixtureName} was not found in ${RUNTIME_QA_CONFIG_RELATIVE_PATH}.`);
  }
  if (fixture.provider !== 'supabase' || fixture.strategy !== 'auth-admin-user') {
    throw new Error(`Runtime QA fixture ${fixtureName} must declare provider=supabase and strategy=auth-admin-user.`);
  }
}

function readRuntimeQaFixtureConfig(root: string, fixtureName: string): RuntimeQaFixtureConfig | undefined {
  const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  const config = JSON.parse(readFileSync(path, 'utf-8')) as RuntimeQaConfig;
  return config.fixtures?.[fixtureName];
}

function resolveSupabaseBackend(root: string, requested: RuntimeQaFixtureProviderBackend): {
  backend: RuntimeQaFixtureProviderBackend;
  available: boolean;
  requiresAgentMcp?: boolean;
  reason: string;
} {
  if (requested === 'mcp') {
    const configured = hasSupabaseMcp(root);
    return {
      backend: 'mcp',
      available: false,
      requiresAgentMcp: configured,
      reason: configured
        ? 'Supabase MCP is configured for Claude-mediated provisioning. The runtime QA shell runner needs the Claude agent step to create the fixture env file before simulator commands run.'
        : 'Supabase MCP is not configured for this project/session.',
    };
  }

  const env = readRuntimeQaEnv(root);
  const hasEnv = Boolean((env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL) && env.SUPABASE_SERVICE_ROLE_KEY);
  if (requested === 'env') {
    return {
      backend: 'env',
      available: hasEnv,
      reason: hasEnv
        ? 'SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available.'
        : 'Missing SUPABASE_SERVICE_ROLE_KEY or Supabase URL for env backend.',
    };
  }

  if (hasEnv) {
    return {
      backend: 'env',
      available: true,
      reason: 'Auto backend selected env because Supabase service-role credentials are available.',
    };
  }

  if (hasSupabaseMcp(root)) {
    return {
      backend: 'mcp',
      available: false,
      requiresAgentMcp: true,
      reason: 'Auto backend found Supabase MCP configuration for Claude-mediated provisioning. The runtime QA shell runner needs the Claude agent step to create the fixture env file before simulator commands run.',
    };
  }

  return {
    backend: 'env',
    available: false,
    reason: 'Auto backend found neither Supabase service-role env nor Supabase MCP configuration.',
  };
}

function readRuntimeQaEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const relativePath of ['.env', '.env.local', 'apps/mobile/.env', 'apps/mobile/.env.local']) {
    loadEnvFile(resolve(root, relativePath), env);
  }
  return env;
}

function loadEnvFile(path: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (env[key] !== undefined) continue;
    env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function requireSupabaseEnv(env: NodeJS.ProcessEnv): SupabaseEnv {
  const url = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL for Supabase fixture provider.');
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Supabase auth-admin fixture provisioning must run only in a trusted local/CI shell.');
  }
  return { url, serviceRoleKey };
}

async function createSupabaseUser(
  env: SupabaseEnv,
  user: { email: string; password: string; fixtureName: string; runId: string },
): Promise<{ id: string }> {
  const response = await fetch(`${env.url.replace(/\/$/, '')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: supabaseAdminHeaders(env),
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: {
        runtime_qa: true,
        fixture: user.fixtureName,
        run_id: user.runId,
      },
    }),
  });
  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Failed to create Supabase runtime QA user: ${errorMessage(json, response.status)}`);
  }
  const id = typeof json.id === 'string' ? json.id : undefined;
  if (!id) throw new Error('Supabase admin create user returned no user id.');
  return { id };
}

async function deleteSupabaseUser(env: SupabaseEnv, userId: string): Promise<void> {
  const response = await fetch(`${env.url.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: supabaseAdminHeaders(env),
  });
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(`Failed to delete Supabase runtime QA user ${userId}: ${errorMessage(await readJsonResponse(response), response.status)}`);
  }
}

function supabaseAdminHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    Authorization: `Bearer ${env.serviceRoleKey}`,
    apikey: env.serviceRoleKey,
    'Content-Type': 'application/json',
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorMessage(json: Record<string, unknown>, status: number): string {
  const message = typeof json.message === 'string'
    ? json.message
    : typeof json.error_description === 'string'
      ? json.error_description
      : typeof json.error === 'string'
        ? json.error
        : `HTTP ${status}`;
  return message;
}

function renderFixtureEnv(
  fixtureName: string,
  state: RuntimeQaFixtureState,
  fixture: RuntimeQaFixtureConfig,
): string {
  const defaultPrefix = toEnvPrefix(fixtureName);
  const emailEnv = fixture.email_env ?? `${defaultPrefix}_EMAIL`;
  const passwordEnv = fixture.password_env ?? `${defaultPrefix}_PASSWORD`;
  const userIdEnv = fixture.user_id_env ?? `${defaultPrefix}_ID`;
  return [
    `${emailEnv}=${shellQuote(state.email)}`,
    `${passwordEnv}=${shellQuote(state.password)}`,
    `${userIdEnv}=${shellQuote(state.user_id)}`,
    '',
  ].join('\n');
}

function readFixtureState(root: string, fixtureName: string): RuntimeQaFixtureState | undefined {
  const { statePath } = fixtureStatePaths(root, fixtureName);
  if (!existsSync(statePath)) return undefined;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8')) as RuntimeQaFixtureState;
  } catch {
    return undefined;
  }
}

function fixtureStatePaths(root: string, fixtureName: string): { statePath: string; envPath: string } {
  const name = sanitizeFixtureName(fixtureName);
  return {
    statePath: resolve(root, RUNTIME_QA_RUNTIME_DIR, `${name}.json`),
    envPath: resolve(root, RUNTIME_QA_RUNTIME_DIR, `${name}.env`),
  };
}

function failedFixtureResult(
  root: string,
  fixtureName: string,
  action: RuntimeQaFixtureAction,
  backend: RuntimeQaFixtureProviderBackend,
  reason: string,
): RuntimeQaFixtureProvisionResult {
  const paths = fixtureStatePaths(root, fixtureName);
  return {
    root,
    fixture: fixtureName,
    provider: 'supabase',
    backend,
    action,
    ok: false,
    statePath: paths.statePath,
    envPath: paths.envPath,
    reason,
  };
}

function unsupportedMcpResult(
  root: string,
  fixtureName: string,
  action: RuntimeQaFixtureAction,
  reason: string,
): RuntimeQaFixtureProvisionResult {
  const paths = fixtureStatePaths(root, fixtureName);
  return {
    root,
    fixture: fixtureName,
    provider: 'supabase',
    backend: 'mcp',
    action,
    ok: false,
    statePath: paths.statePath,
    envPath: paths.envPath,
    agent_action: mcpAgentAction(fixtureName, action, paths, reason),
    reason,
  };
}

function mcpAgentAction(
  fixtureName: string,
  action: RuntimeQaFixtureAction,
  paths: { statePath: string; envPath: string },
  reason: string,
): RuntimeQaFixtureAgentAction {
  const prefix = toEnvPrefix(fixtureName);
  return {
    kind: 'supabase-auth-admin-user',
    transport: 'claude-mcp',
    action,
    fixture: fixtureName,
    statePath: paths.statePath,
    envPath: paths.envPath,
    required_env: {
      email: `${prefix}_EMAIL`,
      password: `${prefix}_PASSWORD`,
      user_id: `${prefix}_ID`,
    },
    safety: [
      'Use a development or testing Supabase project, never production data.',
      'Use an explicit Supabase Auth/Admin user-management tool when the MCP server exposes one.',
      'Do not insert, update, or delete rows directly in auth.users via SQL as a fixture shortcut.',
    ],
    instructions: [
      reason,
      action === 'provision'
        ? `Create a confirmed disposable Supabase Auth user for fixture "${fixtureName}".`
        : `Delete the Supabase Auth user recorded in ${paths.statePath}, if it exists.`,
      action === 'provision'
        ? `Write ${paths.statePath} with provider, strategy, backend, user_id, email, password, and created_at.`
        : `Remove ${paths.statePath} and ${paths.envPath} after the user is deleted or confirmed absent.`,
      action === 'provision'
        ? `Write ${paths.envPath} with ${prefix}_EMAIL, ${prefix}_PASSWORD, and ${prefix}_ID for the simulator command.`
        : 'Keep teardown idempotent: missing state or already-deleted users are not failures.',
    ],
  };
}

function hasSupabaseMcp(root: string): boolean {
  if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MCP_URL) return true;
  const candidates = [
    resolve(root, '.mcp.json'),
    resolve(process.env.HOME ?? '', '.claude.json'),
    resolve(process.env.HOME ?? '', '.codex', 'config.toml'),
  ];
  return candidates.some((path) => {
    if (!existsSync(path)) return false;
    try {
      return /\bsupabase\b/i.test(readFileSync(path, 'utf-8'));
    } catch {
      return false;
    }
  });
}

function sanitizeFixtureName(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'fixture';
}

function toEnvPrefix(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'RUNTIME_QA_FIXTURE';
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'fixture';
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

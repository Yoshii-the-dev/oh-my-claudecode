import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import type { ProductInterventionHandoff, ProductInterventionRoute } from './intervention-router.js';

export type ProductInterventionExecutionSurface =
  | 'agent-prompt'
  | 'stack-plan'
  | 'team-start'
  | 'slash-skill'
  | 'manual';

export interface ProductInterventionExecutionStep {
  route_id: string;
  agent: ProductInterventionRoute['agent'];
  source_command: string;
  execution_surface: ProductInterventionExecutionSurface;
  executable: boolean;
  review_required: boolean;
  reason: string;
  argv?: string[];
}

export interface ProductInterventionExecutionPlan {
  schema_version: 1;
  produced_at: string;
  agent_role: 'product-intervention-execution-planner';
  source_handoff: string;
  cycle_id?: string;
  cycle_goal?: string;
  cycle_stage: ProductInterventionHandoff['cycle_stage'];
  provider: string;
  steps: ProductInterventionExecutionStep[];
  executable_step_count: number;
  review_required_step_count: number;
  manual_step_count: number;
  next_argv?: string[];
}

export interface ProductInterventionExecutionPlanWriteResult {
  jsonPath: string;
  mdPath: string;
}

export interface BuildProductInterventionExecutionPlanOptions {
  provider?: string;
  sourceHandoff?: string;
}

export const PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-interventions/execution-plan.json';

const DEFAULT_PROVIDER = 'codex';
const PRODUCT_INTERVENTION_EXECUTION_PLAN_MD_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-interventions/execution-plan.md';

export function buildProductInterventionExecutionPlan(
  handoff: ProductInterventionHandoff,
  options: BuildProductInterventionExecutionPlanOptions = {},
): ProductInterventionExecutionPlan {
  const provider = normalizeProvider(options.provider);
  const steps = handoff.routes.map((route) => buildStep(route, provider));
  const firstExecutable = steps.find((step) => step.executable);

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-intervention-execution-planner',
    source_handoff: options.sourceHandoff ?? '.omc/handoffs/product-cycle-interventions/current.json',
    cycle_id: handoff.cycle_id,
    cycle_goal: handoff.cycle_goal,
    cycle_stage: handoff.cycle_stage,
    provider,
    steps,
    executable_step_count: steps.filter((step) => step.executable).length,
    review_required_step_count: steps.filter((step) => step.review_required).length,
    manual_step_count: steps.filter((step) => !step.executable).length,
    next_argv: firstExecutable?.argv,
  };
}

export function writeProductInterventionExecutionPlan(
  root: string,
  plan: ProductInterventionExecutionPlan,
): ProductInterventionExecutionPlanWriteResult {
  const jsonPath = resolve(root, PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH);
  const mdPath = resolve(root, PRODUCT_INTERVENTION_EXECUTION_PLAN_MD_RELATIVE_PATH);
  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, plan);
  atomicWriteFileSync(mdPath, renderProductInterventionExecutionPlan(plan));
  return { jsonPath, mdPath };
}

export function readProductInterventionExecutionPlan(root = process.cwd()): ProductInterventionExecutionPlan | undefined {
  const path = resolve(root, PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductInterventionExecutionPlan;
}

export function renderProductInterventionExecutionPlan(plan: ProductInterventionExecutionPlan): string {
  const lines = [
    `# Product Cycle Intervention Execution Plan: ${plan.cycle_goal ?? plan.cycle_id ?? plan.cycle_stage}`,
    '',
    `produced_at: ${plan.produced_at}`,
    `cycle_id: ${plan.cycle_id ?? 'unknown'}`,
    `cycle_stage: ${plan.cycle_stage}`,
    `provider: ${plan.provider}`,
    `source_handoff: ${plan.source_handoff}`,
    `executable_step_count: ${plan.executable_step_count}`,
    `review_required_step_count: ${plan.review_required_step_count}`,
    `manual_step_count: ${plan.manual_step_count}`,
    `next_argv: ${plan.next_argv ? renderArgv(plan.next_argv) : 'none'}`,
    '',
    '## Steps',
  ];

  if (plan.steps.length === 0) {
    lines.push('- none');
  } else {
    for (const step of plan.steps) {
      lines.push(`- ${step.route_id}: ${step.execution_surface}`);
      lines.push(`  - agent: ${step.agent}`);
      lines.push(`  - executable: ${step.executable}`);
      lines.push(`  - review_required: ${step.review_required}`);
      lines.push(`  - reason: ${step.reason}`);
      lines.push(`  - source_command: ${step.source_command}`);
      lines.push(`  - argv: ${step.argv ? renderArgv(step.argv) : 'none'}`);
    }
  }

  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH}`);
  lines.push(`  - ${PRODUCT_INTERVENTION_EXECUTION_PLAN_MD_RELATIVE_PATH}`);
  lines.push('');

  return lines.join('\n');
}

function buildStep(route: ProductInterventionRoute, provider: string): ProductInterventionExecutionStep {
  const promptRoute = parsePromptRoute(route.command);
  if (promptRoute) {
    return {
      route_id: route.id,
      agent: route.agent,
      source_command: route.command,
      execution_surface: 'agent-prompt',
      executable: true,
      review_required: false,
      reason: 'Prompt routes can run through the provider advisor with the matching agent prompt.',
      argv: ['omc', 'ask', provider, '--agent-prompt', promptRoute.role, '--prompt', promptRoute.prompt],
    };
  }

  const stackRoute = parseSlashCommand(route.command, '/stack-provision');
  if (stackRoute) {
    return {
      route_id: route.id,
      agent: route.agent,
      source_command: route.command,
      execution_surface: 'stack-plan',
      executable: true,
      review_required: true,
      reason: 'Stack provisioning is planned headlessly first; applying installs remains an explicit reviewed action.',
      argv: ['omc', 'stack', 'plan', ...stackRoute.args],
    };
  }

  const pipelineRoute = parsePipelineRoute(route, provider);
  if (pipelineRoute) {
    return pipelineRoute;
  }

  const slashRoute = parseGenericSlashCommand(route.command);
  if (slashRoute) {
    return {
      route_id: route.id,
      agent: route.agent,
      source_command: route.command,
      execution_surface: 'slash-skill',
      executable: false,
      review_required: true,
      reason: 'This route is an interactive slash skill and needs an orchestrator-specific execution surface.',
    };
  }

  return {
    route_id: route.id,
    agent: route.agent,
    source_command: route.command,
    execution_surface: 'manual',
    executable: false,
    review_required: true,
    reason: 'The command is not recognized as a safe automatic execution surface.',
  };
}

function parsePipelineRoute(
  route: ProductInterventionRoute,
  provider: string,
): ProductInterventionExecutionStep | undefined {
  if (route.agent !== 'product-pipeline' && route.agent !== 'backend-pipeline') return undefined;
  const expectedCommand = route.agent === 'product-pipeline' ? '/product-pipeline' : '/backend-pipeline';
  const parsed = parseSlashCommand(route.command, expectedCommand);
  if (!parsed) return undefined;

  const routeTarget = parsed.args.join(' ').trim() || route.purpose;
  const task = [
    `Run ${route.agent} for product-cycle route "${route.id}".`,
    `Target: ${routeTarget}`,
    `Trigger: ${route.trigger}`,
    `Purpose: ${route.purpose}`,
    `Source command: ${route.command}`,
    'Use the existing product-cycle artifacts as context, keep the diff small, and produce verification evidence.',
  ].join('\n');

  return {
    route_id: route.id,
    agent: route.agent,
    source_command: route.command,
    execution_surface: 'team-start',
    executable: true,
    review_required: true,
    reason: 'Pipeline slash routes can be launched as governed team jobs instead of direct interactive slash execution.',
    argv: ['omc', 'team', 'start', '--agent', provider, '--count', '2', '--subject', route.agent, '--task', task],
  };
}

function parsePromptRoute(command: string): { role: string; prompt: string } | undefined {
  const tokens = splitCommandLine(command);
  if (tokens.length < 2) return undefined;
  const first = tokens[0];
  const match = first.match(/^\/prompts:([a-z][a-z0-9-]*)$/);
  if (!match) return undefined;
  return {
    role: match[1],
    prompt: tokens.slice(1).join(' ').trim(),
  };
}

function parseSlashCommand(command: string, commandName: string): { args: string[] } | undefined {
  const tokens = splitCommandLine(command);
  if (tokens[0] !== commandName) return undefined;
  return { args: tokens.slice(1) };
}

function parseGenericSlashCommand(command: string): { commandName: string } | undefined {
  const tokens = splitCommandLine(command);
  const commandName = tokens[0];
  if (!commandName?.startsWith('/')) return undefined;
  return { commandName };
}

function splitCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function normalizeProvider(provider: string | undefined): string {
  const normalized = (provider ?? DEFAULT_PROVIDER).trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'gemini') return normalized;
  return DEFAULT_PROVIDER;
}

function renderArgv(argv: string[]): string {
  return argv.map((arg) => (/^[a-z0-9_./:=,-]+$/i.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}

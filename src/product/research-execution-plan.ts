import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import type { ProductResearchHandoff, ProductResearchRoute } from './research-router.js';

export type ProductResearchExecutionSurface = 'agent-prompt' | 'stack-plan' | 'manual';

export interface ProductResearchExecutionStep {
  route_id: string;
  agent: ProductResearchRoute['agent'];
  source_command: string;
  execution_surface: ProductResearchExecutionSurface;
  executable: boolean;
  review_required: boolean;
  reason: string;
  expected_artifact: string;
  argv?: string[];
}

export interface ProductResearchExecutionPlan {
  schema_version: 1;
  produced_at: string;
  agent_role: 'product-research-execution-planner';
  source_handoff: string;
  cycle_id?: string;
  cycle_goal?: string;
  cycle_stage: ProductResearchHandoff['cycle_stage'];
  provider: string;
  research_artifact: string;
  steps: ProductResearchExecutionStep[];
  executable_step_count: number;
  manual_step_count: number;
  next_argv?: string[];
}

export interface ProductResearchExecutionPlanWriteResult {
  jsonPath: string;
  mdPath: string;
}

export interface BuildProductResearchExecutionPlanOptions {
  provider?: string;
  sourceHandoff?: string;
}

export const PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-research/execution-plan.json';

const DEFAULT_PROVIDER = 'codex';
const PRODUCT_RESEARCH_EXECUTION_PLAN_MD_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-research/execution-plan.md';

export function buildProductResearchExecutionPlan(
  handoff: ProductResearchHandoff,
  options: BuildProductResearchExecutionPlanOptions = {},
): ProductResearchExecutionPlan {
  const provider = normalizeProvider(options.provider);
  const steps = handoff.routes.map((route) => buildStep(route, provider));
  const firstExecutable = steps.find((step) => step.executable);

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-research-execution-planner',
    source_handoff: options.sourceHandoff ?? '.omc/handoffs/product-cycle-research/current.json',
    cycle_id: handoff.cycle_id,
    cycle_goal: handoff.cycle_goal,
    cycle_stage: handoff.cycle_stage,
    provider,
    research_artifact: handoff.research_artifact,
    steps,
    executable_step_count: steps.filter((step) => step.executable).length,
    manual_step_count: steps.filter((step) => !step.executable).length,
    next_argv: firstExecutable?.argv,
  };
}

export function writeProductResearchExecutionPlan(
  root: string,
  plan: ProductResearchExecutionPlan,
): ProductResearchExecutionPlanWriteResult {
  const jsonPath = resolve(root, PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH);
  const mdPath = resolve(root, PRODUCT_RESEARCH_EXECUTION_PLAN_MD_RELATIVE_PATH);
  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, plan);
  atomicWriteFileSync(mdPath, renderProductResearchExecutionPlan(plan));
  return { jsonPath, mdPath };
}

export function readProductResearchExecutionPlan(root = process.cwd()): ProductResearchExecutionPlan | undefined {
  const path = resolve(root, PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as ProductResearchExecutionPlan;
}

export function renderProductResearchExecutionPlan(plan: ProductResearchExecutionPlan): string {
  const lines = [
    `# Product Cycle Research Execution Plan: ${plan.cycle_goal ?? plan.cycle_id ?? plan.cycle_stage}`,
    '',
    `produced_at: ${plan.produced_at}`,
    `cycle_id: ${plan.cycle_id ?? 'unknown'}`,
    `cycle_stage: ${plan.cycle_stage}`,
    `provider: ${plan.provider}`,
    `source_handoff: ${plan.source_handoff}`,
    `research_artifact: ${plan.research_artifact}`,
    `executable_step_count: ${plan.executable_step_count}`,
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
      lines.push(`  - expected_artifact: ${step.expected_artifact}`);
      lines.push(`  - source_command: ${step.source_command}`);
      lines.push(`  - argv: ${step.argv ? renderArgv(step.argv) : 'none'}`);
    }
  }

  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH}`);
  lines.push(`  - ${PRODUCT_RESEARCH_EXECUTION_PLAN_MD_RELATIVE_PATH}`);
  lines.push('');

  return lines.join('\n');
}

function buildStep(route: ProductResearchRoute, provider: string): ProductResearchExecutionStep {
  const promptRoute = parsePromptRoute(route.command);
  if (promptRoute) {
    return {
      route_id: route.id,
      agent: route.agent,
      source_command: route.command,
      execution_surface: 'agent-prompt',
      executable: true,
      review_required: false,
      reason: 'Research prompt routes can run through the provider advisor with the matching agent prompt.',
      expected_artifact: route.expectedArtifact,
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
      expected_artifact: route.expectedArtifact,
      argv: ['omc', 'stack', 'plan', ...stackRoute.args],
    };
  }

  return {
    route_id: route.id,
    agent: route.agent,
    source_command: route.command,
    execution_surface: 'manual',
    executable: false,
    review_required: true,
    reason: 'The research command is not recognized as a safe automatic execution surface.',
    expected_artifact: route.expectedArtifact,
  };
}

function parseSlashCommand(command: string, commandName: string): { args: string[] } | undefined {
  const tokens = splitCommandLine(command);
  if (tokens[0] !== commandName) return undefined;
  return { args: tokens.slice(1) };
}

function parsePromptRoute(command: string): { role: string; prompt: string } | undefined {
  const tokens = splitCommandLine(command);
  if (tokens.length < 2) return undefined;
  const match = tokens[0].match(/^\/prompts:([a-z][a-z0-9-]*)$/);
  if (!match) return undefined;
  return {
    role: match[1],
    prompt: tokens.slice(1).join(' ').trim(),
  };
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
      if (char === quote) quote = undefined;
      else current += char;
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

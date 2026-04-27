/**
 * Agent Structured Output — Runtime
 *
 * Validates, hydrates, renders, and writes OMC agent structured outputs.
 * This is the JSON-first replacement for the <handoff> envelope system.
 *
 * Pattern follows cycle-document.ts: JSON is source of truth, Markdown is a projection.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync, atomicWriteFileSync, ensureDirSync } from '../lib/atomic-write.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export const AGENT_OUTPUT_SCHEMA_VERSION = 2;

export type AgentOutputStatus =
  | 'complete'
  | 'partial'
  | 'halted'
  | 'blocked'
  | 'needs-research'
  | 'needs-human-decision';

export type ArtifactStatus = 'draft' | 'partial' | 'complete' | 'approved' | 'rejected' | 'halted';

export type ArtifactType = 'primary' | 'supporting' | 'draft';

export type StrategyVerdict = 'approve' | 'revise' | 'rewind';

export type CompatibilityStatus = 'compatible' | 'risky' | 'blocked' | 'unknown';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AgentOutputRouting {
  next_recommended: AgentOutputRoutingEntry[];
  gate_readiness?: Record<string, boolean>;
}

export interface AgentOutputRoutingEntry {
  agent: string;
  purpose: string;
  required: boolean;
}

export interface AgentOutputArtifact {
  path: string;
  type: ArtifactType;
  supersedes?: string;
}

export interface AgentOutputPrimaryArtifact {
  path: string;
  status: ArtifactStatus;
}

export interface AgentOutputUserQuestion {
  question: string;
  blocking: boolean;
}

export interface AgentOutputHalt {
  reason: string;
  remediation: string;
  resume_from?: string;
}

export interface AgentOutputStrategyScorecard {
  weights: {
    product_fit: number;
    operability: number;
    ecosystem_maturity: number;
    performance: number;
    security_compliance: number;
    cost_efficiency: number;
  };
  top2_gap: number;
  [key: string]: unknown;
}

export interface AgentOutputStrategyCompatibility {
  overall_status: CompatibilityStatus;
  blocked_pairs: number;
  unknown_pairs: number;
  [key: string]: unknown;
}

export interface AgentOutputStrategyRisk {
  id: string;
  severity: RiskSeverity;
  mitigation: string;
  [key: string]: unknown;
}

export interface AgentOutputStrategyDecision {
  verdict: StrategyVerdict;
  rationale: string;
}

export interface AgentOutputStrategyPermissions {
  read_scope: string;
  write_scope: string;
}

export interface AgentOutputStrategy {
  inputs_digest?: string;
  assumptions?: string[];
  scorecard?: AgentOutputStrategyScorecard;
  compatibility_report?: AgentOutputStrategyCompatibility;
  risk_register?: AgentOutputStrategyRisk[];
  decision?: AgentOutputStrategyDecision;
  permissions?: AgentOutputStrategyPermissions;
}

export interface AgentOutput {
  schema_version: 2;
  run_id?: string;
  agent_role: string;
  produced_at: string;
  status: AgentOutputStatus;
  primary_artifact: AgentOutputPrimaryArtifact;
  routing: AgentOutputRouting;
  signals: Record<string, number | string | boolean>;
  artifacts_produced: AgentOutputArtifact[];
  context_consumed: string[];
  requires_user_input?: AgentOutputUserQuestion[];
  halt?: AgentOutputHalt;
  strategy?: AgentOutputStrategy;
  confidence: number;
  evidence: string[];
  blocking_issues?: string[];
}

export interface AgentOutputValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface AgentOutputValidationResult {
  ok: boolean;
  output?: AgentOutput;
  issues: AgentOutputValidationIssue[];
}

export interface AgentOutputWriteResult {
  jsonPath: string;
  mdPath: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<AgentOutputStatus>([
  'complete', 'partial', 'halted', 'blocked', 'needs-research', 'needs-human-decision',
]);

const VALID_ARTIFACT_STATUSES = new Set<ArtifactStatus>([
  'draft', 'partial', 'complete', 'approved', 'rejected', 'halted',
]);

const VALID_ARTIFACT_TYPES = new Set<ArtifactType>(['primary', 'supporting', 'draft']);

const VALID_VERDICTS = new Set<StrategyVerdict>(['approve', 'revise', 'rewind']);

const VALID_COMPAT_STATUSES = new Set<CompatibilityStatus>([
  'compatible', 'risky', 'blocked', 'unknown',
]);

const VALID_RISK_SEVERITIES = new Set<RiskSeverity>(['low', 'medium', 'high', 'critical']);

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a raw JSON value against the AgentOutput schema.
 * Returns a typed result with issues on failure.
 */
export function validateAgentOutput(raw: unknown): AgentOutputValidationResult {
  const issues: AgentOutputValidationIssue[] = [];

  if (!raw || typeof raw !== 'object') {
    issues.push({ severity: 'error', code: 'not-object', message: 'Agent output must be a JSON object' });
    return { ok: false, issues };
  }

  const obj = raw as Record<string, unknown>;

  // schema_version
  if (obj.schema_version !== AGENT_OUTPUT_SCHEMA_VERSION) {
    issues.push({
      severity: 'error',
      code: 'invalid-schema-version',
      message: `schema_version must be ${AGENT_OUTPUT_SCHEMA_VERSION}, got ${String(obj.schema_version)}`,
    });
  }

  // agent_role
  if (typeof obj.agent_role !== 'string' || obj.agent_role.length === 0) {
    issues.push({ severity: 'error', code: 'missing-agent-role', message: 'agent_role is required and must be a non-empty string' });
  }

  // produced_at
  if (typeof obj.produced_at !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(obj.produced_at)) {
    issues.push({ severity: 'error', code: 'invalid-produced-at', message: 'produced_at must be an ISO date string' });
  }

  // status
  if (!VALID_STATUSES.has(obj.status as AgentOutputStatus)) {
    issues.push({
      severity: 'error',
      code: 'invalid-status',
      message: `status must be one of ${[...VALID_STATUSES].join(', ')}`,
    });
  }

  // primary_artifact
  validatePrimaryArtifact(obj.primary_artifact, issues);

  // routing
  validateRouting(obj.routing, issues);

  // signals
  validateSignals(obj.signals, issues);

  // artifacts_produced
  validateArtifactsProduced(obj.artifacts_produced, issues);

  // context_consumed
  if (!Array.isArray(obj.context_consumed)) {
    issues.push({ severity: 'error', code: 'invalid-context-consumed', message: 'context_consumed must be an array' });
  }

  // confidence
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    issues.push({ severity: 'error', code: 'invalid-confidence', message: 'confidence must be a number between 0 and 1' });
  }

  // evidence
  if (!Array.isArray(obj.evidence)) {
    issues.push({ severity: 'error', code: 'invalid-evidence', message: 'evidence must be an array' });
  }

  // halt required when status=halted
  if (obj.status === 'halted') {
    if (!obj.halt || typeof obj.halt !== 'object') {
      issues.push({ severity: 'error', code: 'missing-halt', message: 'halt block is required when status is halted' });
    } else {
      const halt = obj.halt as Record<string, unknown>;
      if (typeof halt.reason !== 'string') {
        issues.push({ severity: 'error', code: 'missing-halt-reason', message: 'halt.reason is required' });
      }
      if (typeof halt.remediation !== 'string') {
        issues.push({ severity: 'error', code: 'missing-halt-remediation', message: 'halt.remediation is required' });
      }
    }
  }

  // requires_user_input (optional, validate shape if present)
  if (obj.requires_user_input !== undefined) {
    if (!Array.isArray(obj.requires_user_input)) {
      issues.push({ severity: 'error', code: 'invalid-user-input', message: 'requires_user_input must be an array' });
    } else {
      for (const [i, item] of (obj.requires_user_input as unknown[]).entries()) {
        if (!item || typeof item !== 'object') {
          issues.push({ severity: 'error', code: 'invalid-user-input-item', message: `requires_user_input[${i}] must be an object` });
        } else {
          const q = item as Record<string, unknown>;
          if (typeof q.question !== 'string') {
            issues.push({ severity: 'error', code: 'invalid-user-input-question', message: `requires_user_input[${i}].question must be a string` });
          }
          if (typeof q.blocking !== 'boolean') {
            issues.push({ severity: 'error', code: 'invalid-user-input-blocking', message: `requires_user_input[${i}].blocking must be a boolean` });
          }
        }
      }
    }
  }

  // strategy (optional, validate shape if present)
  if (obj.strategy !== undefined) {
    validateStrategy(obj.strategy, issues);
  }

  const ok = !issues.some((issue) => issue.severity === 'error');
  return {
    ok,
    output: ok ? (obj as unknown as AgentOutput) : undefined,
    issues,
  };
}

function validatePrimaryArtifact(value: unknown, issues: AgentOutputValidationIssue[]): void {
  if (!value || typeof value !== 'object') {
    issues.push({ severity: 'error', code: 'missing-primary-artifact', message: 'primary_artifact is required' });
    return;
  }
  const pa = value as Record<string, unknown>;
  if (typeof pa.path !== 'string' || pa.path.length === 0) {
    issues.push({ severity: 'error', code: 'missing-primary-artifact-path', message: 'primary_artifact.path is required' });
  }
  if (!VALID_ARTIFACT_STATUSES.has(pa.status as ArtifactStatus)) {
    issues.push({ severity: 'error', code: 'invalid-primary-artifact-status', message: `primary_artifact.status must be one of ${[...VALID_ARTIFACT_STATUSES].join(', ')}` });
  }
}

function validateRouting(value: unknown, issues: AgentOutputValidationIssue[]): void {
  if (!value || typeof value !== 'object') {
    issues.push({ severity: 'error', code: 'missing-routing', message: 'routing is required' });
    return;
  }
  const routing = value as Record<string, unknown>;
  if (!Array.isArray(routing.next_recommended)) {
    issues.push({ severity: 'error', code: 'missing-next-recommended', message: 'routing.next_recommended must be an array' });
    return;
  }
  for (const [i, entry] of routing.next_recommended.entries()) {
    if (!entry || typeof entry !== 'object') {
      issues.push({ severity: 'error', code: 'invalid-routing-entry', message: `routing.next_recommended[${i}] must be an object` });
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.agent !== 'string' || e.agent.length === 0) {
      issues.push({ severity: 'error', code: 'invalid-routing-agent', message: `routing.next_recommended[${i}].agent must be a non-empty string` });
    }
    if (typeof e.purpose !== 'string') {
      issues.push({ severity: 'error', code: 'invalid-routing-purpose', message: `routing.next_recommended[${i}].purpose must be a string` });
    }
    if (typeof e.required !== 'boolean') {
      issues.push({ severity: 'error', code: 'invalid-routing-required', message: `routing.next_recommended[${i}].required must be a boolean` });
    }
  }
}

function validateSignals(value: unknown, issues: AgentOutputValidationIssue[]): void {
  if (!value || typeof value !== 'object') {
    issues.push({ severity: 'error', code: 'missing-signals', message: 'signals is required' });
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
      issues.push({
        severity: 'error',
        code: 'invalid-signal-type',
        message: `signals.${key} must be a number, string, or boolean`,
      });
    }
  }
}

function validateArtifactsProduced(value: unknown, issues: AgentOutputValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ severity: 'error', code: 'missing-artifacts-produced', message: 'artifacts_produced must be a non-empty array' });
    return;
  }
  for (const [i, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      issues.push({ severity: 'error', code: 'invalid-artifact-entry', message: `artifacts_produced[${i}] must be an object` });
      continue;
    }
    const a = item as Record<string, unknown>;
    if (typeof a.path !== 'string') {
      issues.push({ severity: 'error', code: 'invalid-artifact-path', message: `artifacts_produced[${i}].path must be a string` });
    }
    if (!VALID_ARTIFACT_TYPES.has(a.type as ArtifactType)) {
      issues.push({ severity: 'error', code: 'invalid-artifact-type', message: `artifacts_produced[${i}].type must be one of ${[...VALID_ARTIFACT_TYPES].join(', ')}` });
    }
  }
}

function validateStrategy(value: unknown, issues: AgentOutputValidationIssue[]): void {
  if (typeof value !== 'object' || value === null) {
    issues.push({ severity: 'error', code: 'invalid-strategy', message: 'strategy must be an object' });
    return;
  }
  const s = value as Record<string, unknown>;

  if (s.decision !== undefined) {
    if (typeof s.decision !== 'object' || s.decision === null) {
      issues.push({ severity: 'error', code: 'invalid-strategy-decision', message: 'strategy.decision must be an object' });
    } else {
      const d = s.decision as Record<string, unknown>;
      if (!VALID_VERDICTS.has(d.verdict as StrategyVerdict)) {
        issues.push({ severity: 'error', code: 'invalid-strategy-verdict', message: `strategy.decision.verdict must be one of ${[...VALID_VERDICTS].join(', ')}` });
      }
      if (typeof d.rationale !== 'string') {
        issues.push({ severity: 'error', code: 'invalid-strategy-rationale', message: 'strategy.decision.rationale must be a string' });
      }
    }
  }

  if (s.compatibility_report !== undefined) {
    if (typeof s.compatibility_report !== 'object' || s.compatibility_report === null) {
      issues.push({ severity: 'error', code: 'invalid-compat-report', message: 'strategy.compatibility_report must be an object' });
    } else {
      const c = s.compatibility_report as Record<string, unknown>;
      if (!VALID_COMPAT_STATUSES.has(c.overall_status as CompatibilityStatus)) {
        issues.push({ severity: 'error', code: 'invalid-compat-status', message: `strategy.compatibility_report.overall_status must be one of ${[...VALID_COMPAT_STATUSES].join(', ')}` });
      }
    }
  }

  if (s.risk_register !== undefined) {
    if (!Array.isArray(s.risk_register)) {
      issues.push({ severity: 'error', code: 'invalid-risk-register', message: 'strategy.risk_register must be an array' });
    } else {
      for (const [i, risk] of s.risk_register.entries()) {
        if (!risk || typeof risk !== 'object') continue;
        const r = risk as Record<string, unknown>;
        if (!VALID_RISK_SEVERITIES.has(r.severity as RiskSeverity)) {
          issues.push({ severity: 'error', code: 'invalid-risk-severity', message: `strategy.risk_register[${i}].severity must be one of ${[...VALID_RISK_SEVERITIES].join(', ')}` });
        }
      }
    }
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Read and validate an agent output JSON file.
 */
export function readAgentOutput(jsonPath: string): AgentOutputValidationResult {
  if (!existsSync(jsonPath)) {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'file-not-found', message: `Agent output file not found: ${jsonPath}` }],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (error) {
    return {
      ok: false,
      issues: [{
        severity: 'error',
        code: 'invalid-json',
        message: `Failed to parse agent output: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }

  return validateAgentOutput(raw);
}

// ─── Markdown Projection ─────────────────────────────────────────────────────

/**
 * Render an AgentOutput to a human-readable Markdown string.
 * This is the "view" — the JSON is the "model".
 */
export function renderAgentOutputMarkdown(output: AgentOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Agent Output: ${output.agent_role}`);
  lines.push('');
  lines.push(`**Produced:** ${output.produced_at}`);
  lines.push(`**Status:** ${output.status}`);
  lines.push(`**Confidence:** ${output.confidence}`);
  if (output.run_id) {
    lines.push(`**Run ID:** ${output.run_id}`);
  }
  lines.push(`**Primary artifact:** ${output.primary_artifact.path} (${output.primary_artifact.status})`);
  lines.push('');

  // Halt block
  if (output.halt) {
    lines.push('## ⛔ Halt');
    lines.push(`**Reason:** ${output.halt.reason}`);
    lines.push(`**Remediation:** ${output.halt.remediation}`);
    if (output.halt.resume_from) {
      lines.push(`**Resume from:** ${output.halt.resume_from}`);
    }
    lines.push('');
  }

  // User input required
  if (output.requires_user_input && output.requires_user_input.length > 0) {
    lines.push('## ❓ Requires User Input');
    for (const q of output.requires_user_input) {
      lines.push(`- ${q.blocking ? '**[BLOCKING]** ' : ''}${q.question}`);
    }
    lines.push('');
  }

  // Signals
  const signalEntries = Object.entries(output.signals);
  if (signalEntries.length > 0) {
    lines.push('## Key Signals');
    lines.push('| Signal | Value |');
    lines.push('|---|---|');
    for (const [key, value] of signalEntries) {
      lines.push(`| ${key} | ${String(value)} |`);
    }
    lines.push('');
  }

  // Routing
  if (output.routing.next_recommended.length > 0) {
    lines.push('## Routing');
    lines.push('| # | Agent | Purpose | Required |');
    lines.push('|---:|---|---|:---:|');
    for (const [i, entry] of output.routing.next_recommended.entries()) {
      lines.push(`| ${i + 1} | ${entry.agent} | ${entry.purpose} | ${entry.required ? '✅' : '—'} |`);
    }
    lines.push('');
  }

  // Gate readiness
  if (output.routing.gate_readiness) {
    const gates = Object.entries(output.routing.gate_readiness);
    if (gates.length > 0) {
      lines.push('## Gate Readiness');
      for (const [gate, ready] of gates) {
        lines.push(`- ${ready ? '✅' : '⬜'} ${gate}`);
      }
      lines.push('');
    }
  }

  // Strategy (if present)
  if (output.strategy) {
    lines.push('## Strategy');
    if (output.strategy.decision) {
      lines.push(`**Verdict:** ${output.strategy.decision.verdict}`);
      lines.push(`**Rationale:** ${output.strategy.decision.rationale}`);
      lines.push('');
    }
    if (output.strategy.compatibility_report) {
      const cr = output.strategy.compatibility_report;
      lines.push(`**Compatibility:** ${cr.overall_status} (blocked: ${cr.blocked_pairs}, unknown: ${cr.unknown_pairs})`);
      lines.push('');
    }
    if (output.strategy.risk_register && output.strategy.risk_register.length > 0) {
      lines.push('### Risk Register');
      lines.push('| ID | Severity | Mitigation |');
      lines.push('|---|---|---|');
      for (const risk of output.strategy.risk_register) {
        lines.push(`| ${risk.id} | ${risk.severity} | ${risk.mitigation} |`);
      }
      lines.push('');
    }
  }

  // Artifacts produced
  lines.push('## Artifacts Produced');
  for (const a of output.artifacts_produced) {
    lines.push(`- ${a.path} (${a.type})${a.supersedes ? ` — supersedes ${a.supersedes}` : ''}`);
  }
  lines.push('');

  // Context consumed
  if (output.context_consumed.length > 0) {
    lines.push('## Context Consumed');
    for (const c of output.context_consumed) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  // Evidence
  if (output.evidence.length > 0) {
    lines.push('## Evidence');
    for (const e of output.evidence) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  // Blocking issues
  if (output.blocking_issues && output.blocking_issues.length > 0) {
    lines.push('## Blocking Issues');
    for (const b of output.blocking_issues) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }

  // Machine-readable footer (so existing contract validators still work)
  lines.push('---');
  lines.push(`status: ${output.status}`);
  lines.push('evidence:');
  for (const e of output.evidence) {
    lines.push(`  - ${e}`);
  }
  lines.push(`confidence: ${output.confidence}`);
  lines.push('blocking_issues:');
  if (!output.blocking_issues || output.blocking_issues.length === 0) {
    lines.push('  - []');
  } else {
    for (const b of output.blocking_issues) {
      lines.push(`  - ${b}`);
    }
  }
  const nextAction = output.routing.next_recommended.length > 0
    ? `${output.routing.next_recommended[0].agent}: ${output.routing.next_recommended[0].purpose}`
    : 'Chain complete';
  lines.push(`next_action: ${nextAction}`);
  lines.push('artifacts_written:');
  for (const a of output.artifacts_produced) {
    lines.push(`  - ${a.path}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Write agent output as JSON (source of truth) + Markdown projection.
 * JSON path determines the Markdown path: .json → .md
 */
export function writeAgentOutput(
  root: string,
  jsonRelativePath: string,
  output: AgentOutput,
): AgentOutputWriteResult {
  const jsonPath = resolve(root, jsonRelativePath);
  const mdPath = jsonPath.replace(/\.json$/, '.md');

  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, output);
  atomicWriteFileSync(mdPath, renderAgentOutputMarkdown(output));

  return { jsonPath, mdPath };
}

/**
 * Locate the agent output JSON sidecar for an artifact.
 * Convention: .omc/decisions/2026-04-27-technology-knitting.md
 *           → .omc/decisions/2026-04-27-technology-knitting.output.json
 */
export function resolveAgentOutputPath(artifactPath: string): string {
  return artifactPath.replace(/\.(md|json)$/, '.output.json');
}

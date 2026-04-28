/**
 * Agent Structured Output — Runtime
 *
 * Validates, hydrates, renders, and writes OMC agent structured outputs.
 * This is the JSON-first replacement for the <handoff> envelope system.
 *
 * Pattern follows cycle-document.ts: JSON is source of truth, Markdown is a projection.
 */
export declare const AGENT_OUTPUT_SCHEMA_VERSION = 2;
export type AgentOutputStatus = 'complete' | 'partial' | 'halted' | 'blocked' | 'needs-research' | 'needs-human-decision';
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
/**
 * Validate a raw JSON value against the AgentOutput schema.
 * Returns a typed result with issues on failure.
 */
export declare function validateAgentOutput(raw: unknown): AgentOutputValidationResult;
/**
 * Read and validate an agent output JSON file.
 */
export declare function readAgentOutput(jsonPath: string): AgentOutputValidationResult;
/**
 * Render an AgentOutput to a human-readable Markdown string.
 * This is the "view" — the JSON is the "model".
 */
export declare function renderAgentOutputMarkdown(output: AgentOutput): string;
/**
 * Write agent output as JSON (source of truth) + Markdown projection.
 * JSON path determines the Markdown path: .json → .md
 */
export declare function writeAgentOutput(root: string, jsonRelativePath: string, output: AgentOutput): AgentOutputWriteResult;
/**
 * Locate the agent output JSON sidecar for an artifact.
 * Convention: .omc/decisions/2026-04-27-technology-knitting.md
 *           → .omc/decisions/2026-04-27-technology-knitting.output.json
 */
export declare function resolveAgentOutputPath(artifactPath: string): string;
//# sourceMappingURL=agent-output.d.ts.map
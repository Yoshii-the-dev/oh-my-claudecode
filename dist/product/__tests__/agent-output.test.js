import { describe, it, expect } from 'vitest';
import { AGENT_OUTPUT_SCHEMA_VERSION, validateAgentOutput, renderAgentOutputMarkdown, resolveAgentOutputPath, } from '../agent-output.js';
function validOutput(overrides = {}) {
    return {
        schema_version: AGENT_OUTPUT_SCHEMA_VERSION,
        agent_role: 'product-strategist',
        produced_at: '2026-04-27',
        status: 'complete',
        primary_artifact: {
            path: '.omc/product/capability-map/current.md',
            status: 'complete',
        },
        routing: {
            next_recommended: [
                { agent: 'priority-engine', purpose: 'Rank the capability map', required: true },
            ],
            gate_readiness: {
                priority_engine_ready: true,
            },
        },
        signals: {
            mvp_feature_count: 5,
            required_system_count: 8,
            blocked_capability_count: 0,
        },
        artifacts_produced: [
            { path: '.omc/product/capability-map/2026-04-27-knitting.json', type: 'primary' },
            { path: '.omc/product/capability-map/current.md', type: 'supporting' },
        ],
        context_consumed: [
            '.omc/constitution.md',
            '.omc/competitors/landscape/current.md',
        ],
        confidence: 0.85,
        evidence: [
            '.omc/constitution.md',
            '.omc/competitors/landscape/current.md',
        ],
        blocking_issues: [],
        ...overrides,
    };
}
describe('validateAgentOutput', () => {
    it('accepts a valid output', () => {
        const result = validateAgentOutput(validOutput());
        expect(result.ok).toBe(true);
        expect(result.output).toBeDefined();
        expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });
    it('rejects non-object input', () => {
        const result = validateAgentOutput('string');
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'not-object' }));
    });
    it('rejects wrong schema_version', () => {
        const result = validateAgentOutput({ ...validOutput(), schema_version: 99 });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-schema-version' }));
    });
    it('rejects missing agent_role', () => {
        const output = validOutput();
        // @ts-expect-error intentionally invalid
        delete output.agent_role;
        const result = validateAgentOutput(output);
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-agent-role' }));
    });
    it('rejects invalid status', () => {
        const result = validateAgentOutput({ ...validOutput(), status: 'banana' });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-status' }));
    });
    it('rejects confidence out of range', () => {
        const result = validateAgentOutput({ ...validOutput(), confidence: 1.5 });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-confidence' }));
    });
    it('rejects empty artifacts_produced', () => {
        const result = validateAgentOutput({ ...validOutput(), artifacts_produced: [] });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-artifacts-produced' }));
    });
    it('requires halt block when status is halted', () => {
        const result = validateAgentOutput({ ...validOutput(), status: 'halted' });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing-halt' }));
    });
    it('accepts halted with valid halt block', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            status: 'halted',
            halt: {
                reason: 'CRITICAL security finding',
                remediation: 'Add auth middleware',
                resume_from: 'Stage 7',
            },
        });
        expect(result.ok).toBe(true);
    });
    it('rejects invalid signal type', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            signals: { nested: { bad: 'value' } },
        });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-signal-type' }));
    });
    it('rejects invalid routing entry', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            routing: {
                next_recommended: [
                    { agent: '', purpose: 'test', required: true },
                ],
            },
        });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-routing-agent' }));
    });
    it('validates strategy.decision verdict', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            strategy: {
                decision: { verdict: 'yolo', rationale: 'because' },
            },
        });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-strategy-verdict' }));
    });
    it('accepts valid strategy block', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            strategy: {
                inputs_digest: 'abc123',
                assumptions: ['Expo Router is the target framework'],
                scorecard: {
                    weights: {
                        product_fit: 0.30,
                        operability: 0.20,
                        ecosystem_maturity: 0.20,
                        performance: 0.15,
                        security_compliance: 0.10,
                        cost_efficiency: 0.05,
                    },
                    top2_gap: 12,
                },
                compatibility_report: {
                    overall_status: 'compatible',
                    blocked_pairs: 0,
                    unknown_pairs: 1,
                },
                risk_register: [
                    { id: 'r1', severity: 'low', mitigation: 'Monitor adoption' },
                ],
                decision: { verdict: 'approve', rationale: 'Stack is sound' },
                permissions: { read_scope: '.omc/**', write_scope: '.omc/decisions/**' },
            },
        });
        expect(result.ok).toBe(true);
    });
    it('validates requires_user_input shape', () => {
        const result = validateAgentOutput({
            ...validOutput(),
            requires_user_input: [
                { question: 'What color?', blocking: true },
                { question: 123, blocking: true },
            ],
        });
        expect(result.ok).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid-user-input-question' }));
    });
});
describe('renderAgentOutputMarkdown', () => {
    it('renders a complete markdown projection', () => {
        const md = renderAgentOutputMarkdown(validOutput());
        // Header
        expect(md).toContain('# Agent Output: product-strategist');
        expect(md).toContain('**Status:** complete');
        expect(md).toContain('**Confidence:** 0.85');
        // Signals table
        expect(md).toContain('## Key Signals');
        expect(md).toContain('mvp_feature_count');
        expect(md).toContain('5');
        // Routing table
        expect(md).toContain('## Routing');
        expect(md).toContain('priority-engine');
        // Gate readiness
        expect(md).toContain('✅ priority_engine_ready');
        // Standard footer (for backward compat with pipeline-contract-validator)
        expect(md).toContain('status: complete');
        expect(md).toContain('confidence: 0.85');
        expect(md).toContain('next_action: priority-engine:');
    });
    it('renders halt block', () => {
        const md = renderAgentOutputMarkdown({
            ...validOutput(),
            status: 'halted',
            halt: {
                reason: 'Security vulnerability',
                remediation: 'Patch auth',
                resume_from: 'Stage 7',
            },
        });
        expect(md).toContain('## ⛔ Halt');
        expect(md).toContain('Security vulnerability');
        expect(md).toContain('**Resume from:** Stage 7');
    });
    it('renders strategy section', () => {
        const md = renderAgentOutputMarkdown({
            ...validOutput(),
            strategy: {
                decision: { verdict: 'approve', rationale: 'Stack is solid' },
                compatibility_report: { overall_status: 'compatible', blocked_pairs: 0, unknown_pairs: 1 },
                risk_register: [{ id: 'r1', severity: 'medium', mitigation: 'Monitor' }],
            },
        });
        expect(md).toContain('## Strategy');
        expect(md).toContain('**Verdict:** approve');
        expect(md).toContain('### Risk Register');
    });
    it('renders empty chain action when no next_recommended', () => {
        const md = renderAgentOutputMarkdown({
            ...validOutput(),
            routing: { next_recommended: [] },
        });
        expect(md).toContain('next_action: Chain complete');
    });
});
describe('resolveAgentOutputPath', () => {
    it('converts .md to .output.json', () => {
        expect(resolveAgentOutputPath('.omc/decisions/2026-04-27-tech.md'))
            .toBe('.omc/decisions/2026-04-27-tech.output.json');
    });
    it('converts .json to .output.json', () => {
        expect(resolveAgentOutputPath('.omc/portfolio/current.json'))
            .toBe('.omc/portfolio/current.output.json');
    });
});
//# sourceMappingURL=agent-output.test.js.map
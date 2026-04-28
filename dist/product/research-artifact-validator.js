import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
const PLACEHOLDER_PATTERN = /\b(tbd|todo|placeholder|fixture|mock|none|n\/a|unknown)\b/i;
const DEFAULT_RESEARCH_ARTIFACT_RELATIVE_PATH = '.omc/research/product-cycle/current.md';
const REQUIRED_SECTIONS = [
    { code: 'missing-sources', label: 'Sources', pattern: /(?:^|\n)#{1,6}\s*sources?\b|(?:^|\n)sources?\s*:/i },
    { code: 'missing-findings', label: 'Findings', pattern: /(?:^|\n)#{1,6}\s*(?:key\s+)?(?:findings|evidence)\b|(?:^|\n)(?:findings|evidence)\s*:/i },
    { code: 'missing-applicability', label: 'Applicability', pattern: /(?:^|\n)#{1,6}\s*(?:applicability|scope fit|when this applies)\b|(?:^|\n)applicability\s*:/i },
    { code: 'missing-decision-constraints', label: 'Decision Constraints', pattern: /(?:^|\n)#{1,6}\s*(?:decision|implementation)\s+constraints?\b|(?:^|\n)decision_constraints\s*:/i },
    { code: 'missing-risks', label: 'Risks', pattern: /(?:^|\n)#{1,6}\s*risks?\b|(?:^|\n)risks?\s*:/i },
    { code: 'missing-open-questions', label: 'Open Questions', pattern: /(?:^|\n)#{1,6}\s*(?:open questions|unknowns)\b|(?:^|\n)open_questions\s*:/i },
    { code: 'missing-pass-reason', label: 'Pass Reason', pattern: /(?:^|\n)#{1,6}\s*(?:pass|verdict)\s+reason\b|(?:^|\n)pass_reason\s*:/i },
];
const USER_FACING_SECTIONS = [
    { code: 'missing-user-journey', label: 'User Journey', pattern: /\b(user journey|workflow|happy path)\b/i },
    { code: 'missing-empty-states', label: 'Empty States', pattern: /\bempty states?\b/i },
    { code: 'missing-failure-states', label: 'Failure States', pattern: /\b(failure|error) states?\b/i },
    { code: 'missing-loading-states', label: 'Loading States', pattern: /\bloading states?\b/i },
    { code: 'missing-return-session', label: 'Return Session', pattern: /\breturn session|resume(?:s|d)? session\b/i },
    { code: 'missing-accessibility', label: 'Accessibility', pattern: /\baccessibility|a11y\b/i },
    { code: 'missing-perceived-value', label: 'Perceived Value', pattern: /\bperceived value|user value|value signal\b/i },
];
export function validateProductResearchArtifact(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const relativePath = options.artifactPath ?? DEFAULT_RESEARCH_ARTIFACT_RELATIVE_PATH;
    const path = resolve(root, relativePath);
    const issues = [];
    if (!existsSync(path)) {
        issues.push({
            severity: 'error',
            code: 'missing-research-artifact',
            message: `Missing product-cycle research artifact at ${relativePath}`,
        });
        return baseResult(path, false, 'unknown', issues);
    }
    let content = '';
    try {
        content = readFileSync(path, 'utf-8');
    }
    catch (error) {
        issues.push({
            severity: 'error',
            code: 'research-artifact-read-failed',
            message: error instanceof Error ? error.message : 'Unable to read product-cycle research artifact',
        });
        return baseResult(path, true, 'unknown', issues);
    }
    const verdict = extractResearchVerdict(content);
    if (verdict !== 'pass') {
        issues.push({
            severity: 'error',
            code: 'research-verdict-not-pass',
            message: `Research Verdict must be pass before spec/build can continue; got ${verdict}`,
        });
    }
    if (options.expectedCycleId) {
        const actualCycleId = extractFieldValue(content, 'cycle_id');
        if (actualCycleId !== options.expectedCycleId) {
            issues.push({
                severity: 'error',
                code: 'research-cycle-id-mismatch',
                message: `Research artifact cycle_id must match active cycle_id ${options.expectedCycleId}`,
            });
        }
    }
    if (options.expectedCycleStage) {
        const actualCycleStage = extractFieldValue(content, 'cycle_stage');
        if (actualCycleStage !== options.expectedCycleStage) {
            issues.push({
                severity: 'error',
                code: 'research-cycle-stage-mismatch',
                message: `Research artifact cycle_stage must match active stage ${options.expectedCycleStage}`,
            });
        }
    }
    if (options.expectedCycleGoal) {
        const actualCycleGoal = extractFieldValue(content, 'cycle_goal');
        if (actualCycleGoal && normalizeComparableText(actualCycleGoal) !== normalizeComparableText(options.expectedCycleGoal)) {
            issues.push({
                severity: 'warning',
                code: 'research-cycle-goal-mismatch',
                message: 'Research artifact cycle_goal differs from the active cycle goal',
            });
        }
    }
    const requiredSectionCount = countMatchingSections(content, REQUIRED_SECTIONS);
    for (const section of REQUIRED_SECTIONS) {
        if (!section.pattern.test(content)) {
            issues.push({
                severity: 'error',
                code: section.code,
                message: `Research artifact is missing ${section.label}`,
            });
        }
    }
    const sourceCount = countConcreteSources(content);
    if (sourceCount === 0) {
        issues.push({
            severity: 'error',
            code: 'missing-concrete-sources',
            message: 'Research artifact must include at least one concrete non-placeholder source',
        });
    }
    const routeIds = new Set(options.expectedRouteIds ?? []);
    const userFacing = options.userFacing === true || routeIds.has('user-interaction-research');
    const dependencySensitive = options.dependencySensitive === true || routeIds.has('dependency-api-research');
    const backendSensitive = options.backendSensitive === true || routeIds.has('backend-architecture-research');
    const userFacingSectionCount = userFacing ? countMatchingSections(content, USER_FACING_SECTIONS) : 0;
    if (userFacing) {
        for (const section of USER_FACING_SECTIONS) {
            if (!section.pattern.test(content)) {
                issues.push({
                    severity: 'error',
                    code: section.code,
                    message: `User-facing research is missing ${section.label}`,
                });
            }
        }
    }
    if (dependencySensitive && !/\b(official|documentation|docs|api reference|sdk reference)\b/i.test(content)) {
        issues.push({
            severity: 'error',
            code: 'missing-official-docs-evidence',
            message: 'Dependency/API research must cite official documentation or API reference evidence',
        });
    }
    if (backendSensitive && !/\b(architecture|data boundary|api boundary|security|performance|migration|schema)\b/i.test(content)) {
        issues.push({
            severity: 'error',
            code: 'missing-backend-constraints',
            message: 'Backend research must cover architecture, data/API boundaries, security, performance, or schema constraints',
        });
    }
    return {
        ok: !issues.some((issue) => issue.severity === 'error'),
        path,
        exists: true,
        verdict,
        issues,
        metrics: {
            sourceCount,
            requiredSectionCount,
            userFacingSectionCount,
        },
    };
}
function baseResult(path, exists, verdict, issues) {
    return {
        ok: false,
        path,
        exists,
        verdict,
        issues,
        metrics: {
            sourceCount: 0,
            requiredSectionCount: 0,
            userFacingSectionCount: 0,
        },
    };
}
function extractResearchVerdict(content) {
    const yamlMatch = content.match(/(?:^|\n)research[_\s-]*verdict\s*:\s*(pass|blocked)\b/i);
    if (yamlMatch?.[1])
        return yamlMatch[1].toLowerCase();
    const headingMatch = content.match(/(?:^|\n)#{1,6}\s*research verdict\s*\n\s*(pass|blocked)\b/i);
    if (headingMatch?.[1])
        return headingMatch[1].toLowerCase();
    return 'unknown';
}
function countMatchingSections(content, sections) {
    return sections.filter((section) => section.pattern.test(content)).length;
}
function countConcreteSources(content) {
    const sourceBlock = extractSection(content, 'Sources') ?? extractFieldValue(content, 'sources') ?? '';
    return sourceBlock
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .filter((line) => line.length > 0 && !PLACEHOLDER_PATTERN.test(line))
        .length;
}
function extractFieldValue(content, field) {
    const match = content.match(new RegExp(`(?:^|\\n)${field}\\s*:\\s*(.+)`, 'i'));
    return match?.[1]?.trim();
}
function extractSection(content, heading) {
    const match = content.match(new RegExp(`(?:^|\\n)#{1,6}\\s*${heading}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, 'i'));
    return match?.[1]?.trim();
}
function normalizeComparableText(input) {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
}
//# sourceMappingURL=research-artifact-validator.js.map
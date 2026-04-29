export const DEFAULT_SUMMARY_POLICY = {
    mode: 'compact',
    agentResultMaxWords: 120,
    stageReportMaxLines: 20,
    finalReportMaxLines: 35,
    inlineLogMaxChars: 800,
    jsonSidecarRequired: true,
};
export function normalizeSummaryPolicy(policy) {
    return {
        mode: isSummaryMode(policy?.mode) ? policy.mode : DEFAULT_SUMMARY_POLICY.mode,
        agentResultMaxWords: positiveInt(policy?.agentResultMaxWords, DEFAULT_SUMMARY_POLICY.agentResultMaxWords),
        stageReportMaxLines: positiveInt(policy?.stageReportMaxLines, DEFAULT_SUMMARY_POLICY.stageReportMaxLines),
        finalReportMaxLines: positiveInt(policy?.finalReportMaxLines, DEFAULT_SUMMARY_POLICY.finalReportMaxLines),
        inlineLogMaxChars: positiveInt(policy?.inlineLogMaxChars, DEFAULT_SUMMARY_POLICY.inlineLogMaxChars),
        jsonSidecarRequired: policy?.jsonSidecarRequired ?? DEFAULT_SUMMARY_POLICY.jsonSidecarRequired,
    };
}
export function truncateInlineLog(value, policy) {
    const text = value ?? '';
    const max = normalizeSummaryPolicy(policy).inlineLogMaxChars;
    if (text.length <= max)
        return text;
    const suffix = '\n...[truncated; full output is stored in artifacts when available]';
    return `${text.slice(0, Math.max(0, max - suffix.length)).trimEnd()}${suffix}`;
}
export function limitReportLines(value, maxLines, omittedLabel = 'lines omitted by summaryPolicy') {
    const lines = value.split('\n');
    if (lines.length <= maxLines)
        return value;
    const keep = Math.max(1, maxLines - 1);
    return [
        ...lines.slice(0, keep),
        `... (+${lines.length - keep} ${omittedLabel})`,
    ].join('\n');
}
export function limitFinalReport(value, policy) {
    return limitReportLines(value, normalizeSummaryPolicy(policy).finalReportMaxLines);
}
export function limitStageReport(value, policy) {
    return limitReportLines(value, normalizeSummaryPolicy(policy).stageReportMaxLines);
}
function positiveInt(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}
function isSummaryMode(value) {
    return value === 'compact' || value === 'normal' || value === 'verbose';
}
//# sourceMappingURL=summary-policy.js.map
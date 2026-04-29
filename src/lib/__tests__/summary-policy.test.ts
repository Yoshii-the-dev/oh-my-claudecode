import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUMMARY_POLICY,
  limitFinalReport,
  normalizeSummaryPolicy,
  truncateInlineLog,
} from '../summary-policy.js';

describe('summary policy', () => {
  it('normalizes invalid values to compact defaults', () => {
    const policy = normalizeSummaryPolicy({ mode: 'compact', inlineLogMaxChars: -1 });

    expect(policy.mode).toBe('compact');
    expect(policy.inlineLogMaxChars).toBe(DEFAULT_SUMMARY_POLICY.inlineLogMaxChars);
  });

  it('truncates inline logs while keeping artifact-first wording', () => {
    const truncated = truncateInlineLog('x'.repeat(100), { inlineLogMaxChars: 40 });

    expect(truncated.length).toBeLessThanOrEqual(80);
    expect(truncated).toContain('full output is stored in artifacts');
  });

  it('limits final report line count', () => {
    const report = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n');

    expect(limitFinalReport(report, { finalReportMaxLines: 4 }).split('\n')).toHaveLength(4);
  });
});

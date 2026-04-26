/**
 * Multi-axis priority score for candidate ranking.
 *
 * Phase 3 of stack-provision quality hardening. The discovery phase already
 * produces a `score` from coverage matching alone; this module composes a
 * richer ranking signal by combining four normalised axes:
 *
 *   coverage     — how well the candidate fits the requested capability
 *                  matrix (existing `score`, normalised by max in batch)
 *   freshness    — recency: 1.0 for very recent, 0.0 for >365d stale
 *   independence — how many independent trust signals the candidate has
 *                  (GitHub, npm, contributors); rewards multi-sourced
 *                  validation over single-source claims
 *   maturity     — composite of source_trust + source_quality.score
 *
 * The composite is a weighted geometric mean (each axis is multiplicative)
 * so that a zero on any single axis pulls the candidate down significantly.
 * Weights default to {1, 1, 1, 1}, configurable via `policy.priority_weights`.
 *
 * Public API:
 *   computePriorityScore(candidate, { batchMaxCoverage, weights })
 *     -> { composite, axes: {coverage, freshness, independence, maturity},
 *          weights, missing: string[] }
 *
 *   rankCandidates(candidates, { weights }) — convenience: mutates each
 *     candidate to set `priority_score` and returns sorted-by-priority array.
 */

const DEFAULT_WEIGHTS = Object.freeze({
  coverage: 1,
  freshness: 1,
  independence: 1,
  maturity: 1,
});

const FRESHNESS_FLOOR_DAYS = 365;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normaliseCoverage(value, max) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return clamp01(value);
  return clamp01(value / max);
}

function normaliseFreshness(days) {
  if (days == null) return 0.5; // unknown — neutral
  const numeric = Number(days);
  if (!Number.isFinite(numeric)) return 0.5;
  if (numeric <= 0) return 1;
  if (numeric >= FRESHNESS_FLOOR_DAYS) return 0;
  return clamp01(1 - numeric / FRESHNESS_FLOOR_DAYS);
}

function normaliseIndependence(candidate) {
  const trust = candidate.trust_signals;
  if (!trust) return 0;
  const positive = Array.isArray(trust.signals) ? trust.signals.length : 0;
  // Each unique trust signal contributes ~0.2 up to a cap of 1.0.
  return clamp01(positive * 0.2);
}

function normaliseMaturity(candidate) {
  const trust = Number(candidate.source_trust ?? 0);
  const quality = Number(candidate.source_quality?.score ?? 0);
  // source_quality.score is loosely 0..100 in current code; trust is 0..1.
  // Weighted blend leans on trust because quality is heuristic.
  return clamp01(0.7 * trust + 0.3 * (quality / 100));
}

export function computePriorityScore(candidate, options = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return {
      composite: 0,
      axes: { coverage: 0, freshness: 0, independence: 0, maturity: 0 },
      weights: { ...DEFAULT_WEIGHTS },
      missing: ['candidate'],
    };
  }
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const axes = {
    coverage: normaliseCoverage(candidate.score, options.batchMaxCoverage),
    freshness: normaliseFreshness(candidate.freshness_days),
    independence: normaliseIndependence(candidate),
    maturity: normaliseMaturity(candidate),
  };

  const missing = [];
  if (axes.coverage === 0) missing.push('coverage');
  if (candidate.freshness_days == null) missing.push('freshness:unknown');
  if (axes.independence === 0) missing.push('independence');

  // Weighted geometric mean: composite = ∏ axis^weight, then nth root by
  // total weight. We add a tiny epsilon so a single 0 axis does not vanish
  // the entire score — that would make every offline candidate rank zero.
  const epsilon = 0.05;
  let logSum = 0;
  let totalWeight = 0;
  for (const key of ['coverage', 'freshness', 'independence', 'maturity']) {
    const w = Number(weights[key] ?? 0);
    if (w <= 0) continue;
    const v = axes[key] + epsilon;
    logSum += w * Math.log(v);
    totalWeight += w;
  }
  const composite = totalWeight > 0
    ? clamp01(Math.exp(logSum / totalWeight) - epsilon)
    : 0;

  return {
    composite: Number(composite.toFixed(4)),
    axes,
    weights,
    missing,
  };
}

export function rankCandidates(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const batchMaxCoverage = candidates.reduce((m, c) => Math.max(m, Number(c.score ?? 0)), 0);
  const opts = { ...options, batchMaxCoverage };
  for (const c of candidates) {
    const result = computePriorityScore(c, opts);
    c.priority_score = result.composite;
    c.priority_breakdown = {
      axes: result.axes,
      weights: result.weights,
      missing: result.missing,
    };
  }
  return [...candidates].sort((a, b) => {
    const pa = Number(a.priority_score ?? 0);
    const pb = Number(b.priority_score ?? 0);
    if (pb !== pa) return pb - pa;
    const sa = Number(a.score ?? 0);
    const sb = Number(b.score ?? 0);
    if (sb !== sa) return sb - sa;
    return String(a.candidate_id).localeCompare(String(b.candidate_id));
  });
}

export const PRIORITY_SCORE_DEFAULTS = Object.freeze({
  WEIGHTS: DEFAULT_WEIGHTS,
  FRESHNESS_FLOOR_DAYS,
});

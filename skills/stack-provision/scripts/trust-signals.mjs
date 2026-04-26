/**
 * Trust signals: independent verification beyond raw discovery metadata.
 *
 * Phase 2 of stack-provision security hardening. Fetches public-API signals
 * (GitHub repo metrics, npm download counts) and turns them into an additive
 * boost on top of the base `source_trust` score so that suspicious
 * single-author / inactive packages get penalised even when their host site
 * presents them favourably.
 *
 * Design rules:
 *   - Network failures NEVER throw. They are reported as `degraded: true`
 *     with an empty boost so offline runs keep working.
 *   - Boost is bounded: a single signal can move trust by at most 0.05,
 *     all signals combined by at most 0.10. The 0.85 strict-gate threshold
 *     therefore still requires a real base score; we only nudge.
 *   - Results are cached in-process by URL to avoid re-fetching the same
 *     repository for every candidate that points at it.
 *
 * Public API:
 *   gatherTrustSignals(candidate, { network, timeoutMs, fetchImpl, cache })
 *     -> { boost: number, signals: string[], penalties: string[],
 *          degraded: boolean, fetched: number, errors: string[] }
 */

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TOTAL_BOOST = 0.1;
const MAX_TOTAL_PENALTY = 0.1;
const PER_SIGNAL_CAP = 0.05;

// Pure helpers exposed for tests.
export function classifyGithubRepo(repo) {
  const signals = [];
  const penalties = [];
  let boost = 0;
  let penalty = 0;

  if (!repo || typeof repo !== 'object') {
    return { boost: 0, penalty: 0, signals, penalties };
  }

  const stars = Number(repo.stargazers_count ?? 0);
  if (stars >= 500) {
    boost += 0.05;
    signals.push(`github-stars:${stars}>=500`);
  } else if (stars >= 100) {
    boost += 0.03;
    signals.push(`github-stars:${stars}>=100`);
  } else if (stars >= 25) {
    boost += 0.015;
    signals.push(`github-stars:${stars}>=25`);
  } else if (stars < 5) {
    penalty += 0.02;
    penalties.push(`github-stars:${stars}<5`);
  }

  const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : NaN;
  if (Number.isFinite(pushed)) {
    const days = Math.floor((Date.now() - pushed) / 86_400_000);
    if (days <= 30) {
      boost += 0.02;
      signals.push(`github-active:${days}d`);
    } else if (days >= 730) {
      penalty += 0.04;
      penalties.push(`github-stale:${days}d`);
    } else if (days >= 365) {
      penalty += 0.02;
      penalties.push(`github-stale:${days}d`);
    }
  }

  if (repo.archived === true) {
    penalty += 0.05;
    penalties.push('github-archived');
  }
  if (repo.disabled === true) {
    penalty += 0.05;
    penalties.push('github-disabled');
  }

  // Cap each component independently before returning.
  boost = Math.min(boost, PER_SIGNAL_CAP);
  penalty = Math.min(penalty, PER_SIGNAL_CAP);
  return { boost, penalty, signals, penalties };
}

export function classifyContributors(count) {
  const signals = [];
  const penalties = [];
  if (!Number.isFinite(count) || count <= 0) {
    return { boost: 0, penalty: 0, signals, penalties };
  }
  if (count === 1) {
    penalties.push('github-single-contributor');
    return { boost: 0, penalty: 0.03, signals, penalties };
  }
  if (count >= 10) {
    signals.push(`github-contributors:${count}>=10`);
    return { boost: 0.025, penalty: 0, signals, penalties };
  }
  if (count >= 4) {
    signals.push(`github-contributors:${count}>=4`);
    return { boost: 0.015, penalty: 0, signals, penalties };
  }
  return { boost: 0, penalty: 0, signals, penalties };
}

export function classifyNpmDownloads(weeklyDownloads) {
  const signals = [];
  const penalties = [];
  const n = Number(weeklyDownloads);
  if (!Number.isFinite(n)) {
    return { boost: 0, penalty: 0, signals, penalties };
  }
  if (n >= 50_000) {
    signals.push(`npm-downloads:${n}/wk>=50k`);
    return { boost: 0.04, penalty: 0, signals, penalties };
  }
  if (n >= 5_000) {
    signals.push(`npm-downloads:${n}/wk>=5k`);
    return { boost: 0.025, penalty: 0, signals, penalties };
  }
  if (n >= 500) {
    signals.push(`npm-downloads:${n}/wk>=500`);
    return { boost: 0.01, penalty: 0, signals, penalties };
  }
  if (n < 25) {
    penalties.push(`npm-downloads:${n}/wk<25`);
    return { boost: 0, penalty: 0.015, signals, penalties };
  }
  return { boost: 0, penalty: 0, signals, penalties };
}

export function parseGithubRepoFromUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com' && host !== 'api.github.com') {
    return null;
  }
  const segments = parsed.pathname.replace(/^\//, '').split('/').filter(Boolean);
  if (host === 'api.github.com' && segments[0] === 'repos') {
    if (segments.length >= 3) return `${segments[1]}/${segments[2]}`;
    return null;
  }
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1].replace(/\.git$/, '')}`;
  }
  return null;
}

export function parseNpmPackageFromCandidate(candidate) {
  const explicit = candidate?.npm_package ?? candidate?.npm?.name;
  if (explicit) return String(explicit).trim();
  const cmd = candidate?.install?.command ?? '';
  const match = String(cmd).match(/(?:npm install|npx|pnpm add|yarn add)\s+(?:-\S+\s+)*(@[\w./-]+\/[\w./-]+|[\w./-]+)/);
  if (match) return match[1];
  // Plugin-marketplace style entries sometimes carry a `package` field.
  if (candidate?.package) return String(candidate.package).trim();
  return null;
}

async function safeFetchJson(url, { timeoutMs, fetchImpl }) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return await response.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function gatherTrustSignals(candidate, options = {}) {
  const network = options.network !== false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cache = options.cache instanceof Map ? options.cache : new Map();

  const result = {
    boost: 0,
    penalty: 0,
    signals: [],
    penalties: [],
    degraded: false,
    fetched: 0,
    errors: [],
  };

  if (!network) {
    result.degraded = true;
    result.errors.push('network-disabled');
    return result;
  }
  if (typeof fetchImpl !== 'function') {
    result.degraded = true;
    result.errors.push('no-fetch-impl');
    return result;
  }

  const repoSlug = parseGithubRepoFromUrl(candidate?.url ?? candidate?.install?.source_url);
  const npmName = parseNpmPackageFromCandidate(candidate);

  if (repoSlug) {
    const repoKey = `gh:${repoSlug}`;
    let repoData = cache.get(repoKey);
    if (!repoData) {
      try {
        repoData = await safeFetchJson(`https://api.github.com/repos/${repoSlug}`, { timeoutMs, fetchImpl });
        result.fetched += 1;
      } catch (err) {
        repoData = null;
        result.errors.push(`gh-repo:${err.message ?? err}`);
      }
      cache.set(repoKey, repoData ?? null);
    }
    if (repoData) {
      const classified = classifyGithubRepo(repoData);
      result.boost += classified.boost;
      result.penalty += classified.penalty;
      result.signals.push(...classified.signals);
      result.penalties.push(...classified.penalties);
    }

    const contribKey = `gh-contrib:${repoSlug}`;
    let contribCount = cache.get(contribKey);
    if (contribCount === undefined) {
      try {
        const contribs = await safeFetchJson(
          `https://api.github.com/repos/${repoSlug}/contributors?per_page=10&anon=1`,
          { timeoutMs, fetchImpl },
        );
        contribCount = Array.isArray(contribs) ? contribs.length : 0;
        result.fetched += 1;
      } catch (err) {
        contribCount = null;
        result.errors.push(`gh-contrib:${err.message ?? err}`);
      }
      cache.set(contribKey, contribCount);
    }
    if (typeof contribCount === 'number') {
      const classified = classifyContributors(contribCount);
      result.boost += classified.boost;
      result.penalty += classified.penalty;
      result.signals.push(...classified.signals);
      result.penalties.push(...classified.penalties);
    }
  }

  if (npmName) {
    const npmKey = `npm:${npmName}`;
    let downloads = cache.get(npmKey);
    if (downloads === undefined) {
      try {
        const data = await safeFetchJson(
          `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(npmName)}`,
          { timeoutMs, fetchImpl },
        );
        downloads = Number(data?.downloads ?? 0);
        result.fetched += 1;
      } catch (err) {
        downloads = null;
        result.errors.push(`npm:${err.message ?? err}`);
      }
      cache.set(npmKey, downloads);
    }
    if (typeof downloads === 'number') {
      const classified = classifyNpmDownloads(downloads);
      result.boost += classified.boost;
      result.penalty += classified.penalty;
      result.signals.push(...classified.signals);
      result.penalties.push(...classified.penalties);
    }
  }

  result.boost = Math.min(result.boost, MAX_TOTAL_BOOST);
  result.penalty = Math.min(result.penalty, MAX_TOTAL_PENALTY);
  result.degraded = result.fetched === 0 && result.errors.length > 0;
  return result;
}

export const TRUST_SIGNAL_LIMITS = Object.freeze({
  PER_SIGNAL_CAP,
  MAX_TOTAL_BOOST,
  MAX_TOTAL_PENALTY,
  DEFAULT_TIMEOUT_MS,
});

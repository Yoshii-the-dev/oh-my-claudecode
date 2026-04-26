/**
 * Static content scanner for skill payloads.
 *
 * Phase 2 security hardening: before a candidate gets routed to the
 * strict-gate, scan its on-disk content (or in-memory preview) for
 * patterns that indicate prompt-injection, escalation attempts, or
 * unsafe shell behaviour bundled into a SKILL.md.
 *
 * The scanner is intentionally regex-only and synchronous: it must run
 * cheaply for every candidate during discovery without escalating any
 * reviewer privileges. Each rule has a severity band that maps to the
 * existing risk-flag taxonomy:
 *
 *   critical → orchestrator forces manual review and the rule reason is
 *              promoted as a strict-gate failure (`strict-gate:content:*`)
 *   warn     → orchestrator routes the candidate to manual review with
 *              the rule reason attached as `content-scan:<id>`
 *   info     → annotated only, does not block auto-approval
 *
 * Rules carry a `name`, `severity`, `pattern` (RegExp or string), and
 * optional `description`. New rules can be appended without touching
 * the scanning loop.
 *
 * Public API:
 *   scanContent(text, { rules, maxMatchesPerRule })
 *     -> { flags: string[], severity: 'critical'|'warn'|'info'|'none',
 *          findings: Array<{ rule, severity, snippet, line }> }
 *
 *   scanCandidatePayload(candidate, { fs, readFile, rules, maxBytes })
 *     -> Promise<scanContent result>
 *
 *   DEFAULT_RULES — frozen, exported for tests.
 */

import fs from 'node:fs/promises';

const MAX_BYTES_DEFAULT = 256 * 1024;
const MAX_MATCHES_PER_RULE = 5;
const SEVERITY_RANK = { none: 0, info: 1, warn: 2, critical: 3 };

function highest(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export const DEFAULT_RULES = Object.freeze([
  // Prompt-injection / role-confusion patterns.
  {
    name: 'fake-system-tag',
    severity: 'critical',
    pattern: /<\s*\/?\s*system\b[^>]*>/i,
    description: 'Embedded <system> tag — attempts to spoof system messages.',
  },
  {
    name: 'system-reminder-spoof',
    severity: 'critical',
    pattern: /<\s*\/?\s*system-reminder\b[^>]*>/i,
    description: 'Spoofed <system-reminder> tag.',
  },
  {
    name: 'role-override',
    severity: 'warn',
    pattern: /\b(?:you are now|disregard|ignore (?:all|previous|prior)|forget (?:all|previous)|new (?:role|persona|instructions))\b/i,
    description: 'Phrasing typical of prompt-injection role overrides.',
  },
  {
    name: 'hidden-base64-blob',
    severity: 'warn',
    pattern: /\b[A-Za-z0-9+/]{200,}={0,2}\b/,
    description: 'Long base64 blob hidden in skill content.',
  },
  // Tool / capability escalation.
  {
    name: 'broad-tool-permissions',
    severity: 'warn',
    pattern: /\ballowed[-_ ]?tools?\s*[:=]\s*(?:\*|all|"\*")/i,
    description: 'Skill claims unrestricted tool access.',
  },
  {
    name: 'enable-bypass-permissions',
    severity: 'critical',
    pattern: /\b(?:bypass[-_ ]?permissions?|--dangerously-skip|skip-?permissions?|--no-sandbox)\b/i,
    description: 'Requests permission bypass / sandbox skip.',
  },
  {
    name: 'enable-skip-hooks',
    severity: 'warn',
    pattern: /\b(?:OMC_SKIP_HOOKS|DISABLE_OMC|--no-verify|skip-hooks)\b/i,
    description: 'Disables guardrails / verification hooks.',
  },
  // Network / shell escape.
  {
    name: 'shell-pipe-to-shell',
    severity: 'critical',
    pattern: /\bcurl\b[^\n|]*\|\s*(?:bash|sh|zsh)\b/i,
    description: 'curl | bash style remote-execution pattern.',
  },
  {
    name: 'wget-pipe-to-shell',
    severity: 'critical',
    pattern: /\bwget\b[^\n|]*\|\s*(?:bash|sh|zsh)\b/i,
    description: 'wget | bash style remote-execution pattern.',
  },
  {
    name: 'eval-from-fetch',
    severity: 'critical',
    pattern: /\beval\s*\(\s*(?:await\s+)?fetch\s*\(/i,
    description: 'eval(fetch(...)) remote-code-execution pattern.',
  },
  {
    name: 'rm-rf-root',
    severity: 'critical',
    pattern: /\brm\s+-rf\s+(?:\/|~|\$HOME|\/\*)\s*(?:[^\w/]|$)/,
    description: 'Destructive rm -rf on root/home.',
  },
  {
    name: 'shell-network-exfil',
    severity: 'warn',
    pattern: /\b(?:curl|wget|http(?:s)?[:.]\/\/[^\s'"]+).{0,200}\b(?:--data|--upload|@|>\s*\/dev\/tcp)/i,
    description: 'Network exfiltration pattern in shell snippet.',
  },
  // Secret / credential exposure.
  {
    name: 'credential-env-leak',
    severity: 'warn',
    pattern: /\b(?:AWS_SECRET|GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|SLACK_TOKEN)\b\s*[:=]/,
    description: 'Skill references a credential env var by name in code path.',
  },
]);

function lineNumberFor(text, index) {
  if (!Number.isFinite(index) || index < 0) return null;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetAround(text, index, contextChars = 60) {
  if (index == null) return '';
  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + contextChars);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export function scanContent(text, options = {}) {
  const rules = options.rules ?? DEFAULT_RULES;
  const maxMatches = options.maxMatchesPerRule ?? MAX_MATCHES_PER_RULE;
  const findings = [];
  const flags = new Set();
  let severity = 'none';

  if (typeof text !== 'string' || text.length === 0) {
    return { flags: [], severity, findings };
  }

  for (const rule of rules) {
    let pattern = rule.pattern;
    if (!pattern) continue;
    if (typeof pattern === 'string') pattern = new RegExp(pattern);
    // Force a fresh global so we can iterate matches without interfering with caller state.
    const sourceFlags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, sourceFlags);
    let match;
    let count = 0;
    while ((match = re.exec(text)) !== null && count < maxMatches) {
      const idx = match.index;
      findings.push({
        rule: rule.name,
        severity: rule.severity,
        line: lineNumberFor(text, idx),
        snippet: snippetAround(text, idx),
        description: rule.description ?? null,
      });
      flags.add(`content-scan:${rule.name}:${rule.severity}`);
      severity = highest(severity, rule.severity);
      count += 1;
      if (re.lastIndex === idx) re.lastIndex += 1;
    }
  }

  return {
    flags: [...flags],
    severity,
    findings,
  };
}

export async function scanCandidatePayload(candidate, options = {}) {
  const readFile = options.readFile ?? fs.readFile;
  const maxBytes = options.maxBytes ?? MAX_BYTES_DEFAULT;
  const sources = [];

  const localPath = candidate?.install?.source_path ?? candidate?.path;
  if (localPath) sources.push({ kind: 'file', path: localPath });
  if (typeof candidate?.preview === 'string' && candidate.preview.length > 0) {
    sources.push({ kind: 'inline', content: candidate.preview });
  }
  if (typeof candidate?.summary === 'string' && candidate.summary.length > 64) {
    sources.push({ kind: 'inline', content: candidate.summary });
  }

  const aggregate = { flags: new Set(), severity: 'none', findings: [], scanned: 0, errors: [] };

  for (const src of sources) {
    let text = '';
    if (src.kind === 'file') {
      try {
        const raw = await readFile(src.path, 'utf8');
        text = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
      } catch (err) {
        aggregate.errors.push(`read:${src.path}:${err.message ?? err}`);
        continue;
      }
    } else {
      text = src.content.length > maxBytes ? src.content.slice(0, maxBytes) : src.content;
    }

    const result = scanContent(text, options);
    for (const f of result.flags) aggregate.flags.add(f);
    aggregate.findings.push(...result.findings.map((f) => ({ ...f, source: src.kind, path: src.path ?? null })));
    aggregate.severity = highest(aggregate.severity, result.severity);
    aggregate.scanned += 1;
  }

  return {
    flags: [...aggregate.flags],
    severity: aggregate.severity,
    findings: aggregate.findings,
    scanned: aggregate.scanned,
    errors: aggregate.errors,
  };
}

export const CONTENT_SCAN_SEVERITY_RANK = Object.freeze(SEVERITY_RANK);

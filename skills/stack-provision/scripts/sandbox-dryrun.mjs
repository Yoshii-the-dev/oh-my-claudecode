/**
 * Sandboxed dry-run via static behavior fingerprint.
 *
 * Phase 5: a true LLM-driven sandbox would require a mock model and tool
 * harness, which is infeasible inside provision-time tests. Instead, we run
 * a deterministic static analysis that derives the skill's behavior surface
 * — which tools it appears to invoke, what shell commands it embeds, what
 * URLs / env vars / files it reaches for — and compares that surface
 * against the skill's declared `allowed-tools` (when provided) plus a
 * hard-coded baseline of dangerous behaviors.
 *
 * The result is intentionally an "evidence list", not a verdict. The
 * orchestrator decides whether to escalate based on policy:
 *
 *   sandbox.severity = 'critical' → manual decision required
 *   sandbox.severity = 'warn'     → annotated, decision unchanged
 *   sandbox.severity = 'info'     → annotated only
 *
 * Public API:
 *   parseFrontmatter(text)
 *     -> { name, description, allowed_tools: string[]|null, body, raw_frontmatter }
 *   detectToolCallouts(body) -> Array<{ tool, line }>
 *   detectShellCommands(body) -> Array<{ command, line }>
 *   detectUrls(body) -> string[]
 *   detectEnvVarReads(body) -> string[]
 *   buildBehaviorFingerprint(text)
 *     -> { tools, commands, urls, envs, declared_tools, undeclared_tools }
 *   classifyDryRunRisk(fingerprint, { policy }) ->
 *     { severity, flags: string[], findings: Array<{rule, severity, detail}> }
 *   dryRunSkill({ content, policy }) -> {
 *     fingerprint, severity, flags, findings, ok
 *   }
 */

const KNOWN_TOOL_NAMES = new Set([
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'Agent',
  'NotebookEdit',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'AskUserQuestion',
  'Skill',
  'Monitor',
  'CronCreate',
  'CronDelete',
  'EnterPlanMode',
  'ExitPlanMode',
  'ToolSearch',
]);

const DANGEROUS_COMMAND_PATTERNS = [
  { name: 'rm-rf-root', re: /\brm\s+-rf\s+(?:\/|~|\$HOME|\/\*)/, severity: 'critical' },
  { name: 'curl-pipe-shell', re: /\bcurl\b[^\n|]*\|\s*(?:bash|sh|zsh)/i, severity: 'critical' },
  { name: 'wget-pipe-shell', re: /\bwget\b[^\n|]*\|\s*(?:bash|sh|zsh)/i, severity: 'critical' },
  { name: 'eval-fetch', re: /\beval\s*\(\s*(?:await\s+)?fetch\s*\(/i, severity: 'critical' },
  { name: 'sudo-call', re: /\bsudo\b\s+\S+/, severity: 'warn' },
  { name: 'chmod-777', re: /\bchmod\s+777\b/, severity: 'warn' },
  { name: 'no-verify', re: /--no-verify\b/, severity: 'warn' },
  { name: 'bypass-permissions', re: /--dangerously-skip-permissions\b/, severity: 'critical' },
];

const SENSITIVE_ENVS = new Set([
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_TOKEN',
  'STRIPE_SECRET_KEY',
]);

export function parseFrontmatter(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { name: null, description: null, allowed_tools: null, body: '', raw_frontmatter: null };
  }
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\r?\n([\s\S]*))?$/m.exec(text);
  if (!match) {
    return { name: null, description: null, allowed_tools: null, body: text, raw_frontmatter: null };
  }
  const block = match[1];
  const body = match[2] ?? '';
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*:\\s*['"]?([^'"\n]+?)['"]?\\s*$`, 'm').exec(block);
    return m ? m[1].trim() : null;
  };
  let allowedTools = null;
  // Use [ \t]* (not \s*) so the inline matcher does not slurp through a
  // newline and steal the first item of a YAML block sequence.
  const toolsMatch = /^[ \t]*allowed[-_]?tools[ \t]*:[ \t]*([^\n]+)$/m.exec(block);
  if (toolsMatch) {
    const raw = toolsMatch[1].trim();
    if (/^\[.*\]$/.test(raw)) {
      // simple inline array
      allowedTools = raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (raw === '*' || /^["']\*["']$/.test(raw)) {
      allowedTools = ['*'];
    } else {
      allowedTools = raw.split(/\s*,\s*/).map((s) => s.replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
  } else {
    const blockMatch = /^[ \t]*allowed[-_]?tools[ \t]*:[ \t]*\n((?:[ \t]*-[ \t]+.+\n?)+)/m.exec(block);
    if (blockMatch) {
      allowedTools = blockMatch[1]
        .split('\n')
        .map((l) => l.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
    }
  }
  return {
    name: get('name'),
    description: get('description'),
    allowed_tools: allowedTools,
    body,
    raw_frontmatter: block,
  };
}

function lineNumberAt(text, idx) {
  if (!Number.isFinite(idx) || idx < 0) return null;
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function detectToolCallouts(body) {
  if (typeof body !== 'string') return [];
  const out = [];
  // Pattern: `Bash(...)`, `Read(...)`, etc. — function-call shape inside backticks
  // OR plain text. We require uppercase first letter to avoid false positives.
  const re = /\b([A-Z][A-Za-z]{1,32})\s*\(/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    if (KNOWN_TOOL_NAMES.has(name)) {
      out.push({ tool: name, line: lineNumberAt(body, match.index) });
    }
  }
  return dedupeBy(out, (x) => x.tool);
}

export function detectShellCommands(body) {
  if (typeof body !== 'string') return [];
  const out = [];
  // Match commands inside fenced bash/sh code blocks (ignore frontmatter).
  const fenceRe = /```(?:bash|sh|zsh)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(body)) !== null) {
    const block = match[1];
    const baseIdx = match.index + match[0].indexOf(block);
    const lines = block.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(?:\s*\$\s*)?([A-Za-z_][\w./-]*)/);
      if (!m) continue;
      out.push({
        command: m[1],
        line: lineNumberAt(body, baseIdx) + i,
        raw: line,
      });
    }
  }
  return out;
}

export function detectUrls(body) {
  if (typeof body !== 'string') return [];
  const re = /\bhttps?:\/\/[^\s'"`<>)]+/gi;
  const set = new Set();
  let match;
  while ((match = re.exec(body)) !== null) {
    set.add(match[0]);
  }
  return [...set];
}

export function detectEnvVarReads(body) {
  if (typeof body !== 'string') return [];
  const set = new Set();
  // POSIX shell env reads: $FOO, ${FOO}
  const re = /\$\{?([A-Z_][A-Z0-9_]*)\}?/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    set.add(match[1]);
  }
  // Node env reads: process.env.FOO
  const nodeRe = /\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((match = nodeRe.exec(body)) !== null) {
    set.add(match[1]);
  }
  return [...set];
}

function dedupeBy(arr, key) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function buildBehaviorFingerprint(text) {
  const fm = parseFrontmatter(text);
  const tools = detectToolCallouts(fm.body);
  const commands = detectShellCommands(fm.body);
  const urls = detectUrls(fm.body);
  const envs = detectEnvVarReads(fm.body);
  const declared = Array.isArray(fm.allowed_tools) ? fm.allowed_tools : null;
  const undeclared = [];
  if (declared && !declared.includes('*')) {
    const declaredSet = new Set(declared);
    for (const t of tools) {
      if (!declaredSet.has(t.tool)) undeclared.push(t.tool);
    }
  }
  return {
    name: fm.name,
    declared_tools: declared,
    tools: tools.map((t) => t.tool),
    tool_lines: tools,
    commands: dedupeBy(commands, (c) => c.command).map((c) => c.command),
    command_details: commands,
    urls,
    envs,
    undeclared_tools: undeclared,
  };
}

export function classifyDryRunRisk(fingerprint, options = {}) {
  const findings = [];
  const flags = new Set();
  let severity = 'info';

  const escalate = (next) => {
    const rank = { info: 0, warn: 1, critical: 2 };
    if (rank[next] > rank[severity]) severity = next;
  };

  // Undeclared tools — warn for every undeclared tool the skill actually uses.
  if (Array.isArray(fingerprint.undeclared_tools) && fingerprint.undeclared_tools.length > 0) {
    for (const tool of fingerprint.undeclared_tools) {
      findings.push({
        rule: 'undeclared-tool',
        severity: 'warn',
        detail: `tool "${tool}" used in body but not in frontmatter allowed-tools`,
      });
      flags.add(`sandbox:undeclared-tool:${tool}`);
    }
    escalate('warn');
  }

  // Dangerous shell command patterns — match against full command details.
  for (const cmd of fingerprint.command_details ?? []) {
    for (const rule of DANGEROUS_COMMAND_PATTERNS) {
      if (rule.re.test(cmd.raw)) {
        findings.push({
          rule: rule.name,
          severity: rule.severity,
          detail: cmd.raw.slice(0, 160),
        });
        flags.add(`sandbox:${rule.name}:${rule.severity}`);
        escalate(rule.severity);
      }
    }
  }

  // Sensitive env reads — warn-class.
  for (const env of fingerprint.envs ?? []) {
    if (SENSITIVE_ENVS.has(env)) {
      findings.push({
        rule: 'sensitive-env',
        severity: 'warn',
        detail: env,
      });
      flags.add(`sandbox:sensitive-env:${env}`);
      escalate('warn');
    }
  }

  // Network reach — info (unless paired with sensitive env or dangerous cmd).
  if (Array.isArray(fingerprint.urls) && fingerprint.urls.length > 0) {
    flags.add(`sandbox:network-reach:${fingerprint.urls.length}`);
  }

  // Custom policy: max-tools-per-skill, etc.
  const maxTools = options.policy?.sandbox_max_tools;
  if (Number.isFinite(maxTools) && fingerprint.tools.length > maxTools) {
    findings.push({
      rule: 'tool-count-exceeds-policy',
      severity: 'warn',
      detail: `${fingerprint.tools.length} tools, policy max ${maxTools}`,
    });
    flags.add('sandbox:tool-count-exceeds-policy');
    escalate('warn');
  }

  return {
    severity,
    flags: [...flags],
    findings,
  };
}

export function dryRunSkill(options = {}) {
  const content = String(options.content ?? '');
  const fingerprint = buildBehaviorFingerprint(content);
  const verdict = classifyDryRunRisk(fingerprint, { policy: options.policy ?? {} });
  return {
    ok: verdict.severity !== 'critical',
    fingerprint,
    severity: verdict.severity,
    flags: verdict.flags,
    findings: verdict.findings,
  };
}

export const SANDBOX_DRYRUN_DEFAULTS = Object.freeze({
  KNOWN_TOOL_NAMES: [...KNOWN_TOOL_NAMES],
  DANGEROUS_COMMAND_PATTERNS: DANGEROUS_COMMAND_PATTERNS.map((p) => p.name),
  SENSITIVE_ENVS: [...SENSITIVE_ENVS],
});

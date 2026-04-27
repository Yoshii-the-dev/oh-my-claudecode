#!/usr/bin/env node
/**
 * Batch-migrate agent handoff envelopes from legacy YAML to JSON structured output.
 * 
 * For each agent, replaces the Handoff Envelope v2 YAML block with a
 * JSON structured output sidecar instruction that references agent-output.schema.json.
 *
 * Usage: node scripts/migrate-envelopes.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const AGENTS_DIR = join(import.meta.dirname, '..', 'agents');
const DRY_RUN = process.argv.includes('--dry-run');

// Parse YAML envelope to extract agent_role and key_signals for the JSON template
function extractEnvelopeData(yamlBlock) {
  const agentRole = yamlBlock.match(/agent_role:\s*(.+)/)?.[1]?.trim() || 'unknown';
  const verdict = yamlBlock.match(/verdict:\s*(.+)/)?.[1]?.trim() || 'propose';
  const nextAgent = yamlBlock.match(/requested_next_agent:\s*(.+)/)?.[1]?.trim()?.replace(/<|>/g, '') || 'none';
  
  const signals = {};
  const signalBlock = yamlBlock.match(/key_signals:\n((?:\s+.+\n)*)/);
  if (signalBlock) {
    for (const line of signalBlock[1].split('\n')) {
      const m = line.match(/^\s+(\w+):\s*(.+)/);
      if (m) signals[m[1]] = m[2].trim().replace(/<|>/g, '');
    }
  }

  const gates = {};
  const gateBlock = yamlBlock.match(/gate_readiness:\n((?:\s+.+\n)*)/);
  if (gateBlock) {
    for (const line of gateBlock[1].split('\n')) {
      const m = line.match(/^\s+(\w+):\s*(.+)/);
      if (m) gates[m[1]] = m[2].trim().replace(/<|>/g, '');
    }
  }

  const artifacts = [];
  const artBlock = yamlBlock.match(/artifacts_produced:\n((?:\s+-.+\n(?:\s+\w+:.+\n)*)*)/);
  if (artBlock) {
    const paths = artBlock[1].matchAll(/path:\s*"?([^"\n]+)"?/g);
    for (const p of paths) artifacts.push(p[1].trim());
  }

  const contexts = [];
  const ctxBlock = yamlBlock.match(/context_consumed:\n((?:\s+-.+\n)*)/);
  if (ctxBlock) {
    for (const line of ctxBlock[1].split('\n')) {
      const m = line.match(/^\s+-\s*"?([^"\n]+)"?/);
      if (m) contexts.push(m[1].trim());
    }
  }

  return { agentRole, verdict, nextAgent, signals, gates, artifacts, contexts };
}

function buildJsonTemplate(data) {
  const signalsObj = {};
  for (const [k, v] of Object.entries(data.signals)) {
    // Try to convert numeric/bool strings
    if (v === 'true' || v === 'false') signalsObj[k] = v === 'true';
    else if (/^\d+$/.test(v)) signalsObj[k] = parseInt(v, 10);
    else signalsObj[k] = `<${v}>`;
  }

  const gatesObj = {};
  for (const [k, v] of Object.entries(data.gates)) {
    gatesObj[k] = v === 'true' ? true : v === 'false' ? false : true;
  }

  // Build next_recommended from the nextAgent field
  const nextAgents = data.nextAgent.split('|').map(a => a.trim()).filter(Boolean);
  const nextRecommended = nextAgents.length > 0 && nextAgents[0] !== 'none'
    ? [{ agent: nextAgents[0], purpose: `<purpose>`, required: true }]
    : [];

  const output = {
    schema_version: 2,
    agent_role: data.agentRole,
    produced_at: 'YYYY-MM-DD',
    status: 'complete',
    primary_artifact: {
      path: data.artifacts[0] || '<artifact-path>',
      status: 'complete',
    },
    routing: {
      next_recommended: nextRecommended,
      ...(Object.keys(gatesObj).length > 0 ? { gate_readiness: gatesObj } : {}),
    },
    signals: signalsObj,
    artifacts_produced: data.artifacts.length > 0
      ? data.artifacts.map(p => ({ path: p, type: 'primary' }))
      : [{ path: '<artifact-path>', type: 'primary' }],
    context_consumed: data.contexts,
    confidence: 0.85,
    evidence: data.contexts.length > 0 ? data.contexts.slice(0, 2) : ['<evidence>'],
    blocking_issues: [],
  };

  return JSON.stringify(output, null, 6).replace(/^/gm, '    '); // indent 4 for markdown
}

function buildStructuredOutputBlock(data) {
  const json = buildJsonTemplate(data);
  return `    ## Structured Output (REQUIRED)\n    Write a structured output JSON sidecar following \`docs/schemas/agent-output.schema.json\`:\n    \`\`\`json\n${json}\n    \`\`\``;
}

// Find and replace envelope blocks
const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
let updated = 0;
let skipped = 0;

for (const file of files) {
  const path = join(AGENTS_DIR, file);
  let content = readFileSync(path, 'utf-8');
  const name = basename(file, '.md');

  // Skip already migrated agents
  if (content.includes('Structured Output (REQUIRED)')) {
    console.log(`  SKIP ${name} (already migrated)`);
    skipped++;
    continue;
  }

  // Pattern 1: ## Handoff Envelope v2 ... ```yaml ... ```
  // Pattern 2: ## Handoff Envelope (MANDATORY ...) ... <handoff> ... </handoff>
  let replaced = false;

  // Try v2 pattern first (```yaml ... ```)
  const v2Pattern = /^(\s*)(#{2,3}\s*Handoff Envelope v2[^\n]*)\n(?:.*?\n)*?\1```yaml\n([\s\S]*?)\n\1```/m;
  const v2Match = content.match(v2Pattern);
  
  if (v2Match) {
    const yamlBlock = v2Match[3];
    const data = extractEnvelopeData(yamlBlock);
    data.agentRole = name;

    // Also capture any prose between header and ```yaml
    const fullMatch = v2Match[0];
    const replacement = buildStructuredOutputBlock(data);

    content = content.replace(fullMatch, replacement);
    replaced = true;
  }

  // Try v1 pattern (<handoff> ... </handoff>)
  if (!replaced) {
    const v1Pattern = /^(\s*)(#{2,3}\s*Handoff Envelope[^\n]*)\n(?:[\s\S]*?)\n\s*<handoff>\n([\s\S]*?)\n\s*<\/handoff>/m;
    const v1Match = content.match(v1Pattern);
    
    if (v1Match) {
      const yamlBlock = v1Match[3];
      const data = extractEnvelopeData(yamlBlock);
      data.agentRole = name;

      const fullMatch = v1Match[0];
      const replacement = buildStructuredOutputBlock(data);

      content = content.replace(fullMatch, replacement);
      replaced = true;
    }
  }

  if (replaced) {
    if (DRY_RUN) {
      console.log(`  DRY ${name} — would update`);
    } else {
      writeFileSync(path, content, 'utf-8');
      console.log(`  ✅  ${name} — updated`);
    }
    updated++;
  } else {
    console.log(`  ⚠️  ${name} — no envelope found`);
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped (already migrated)`);

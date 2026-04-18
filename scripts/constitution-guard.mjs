#!/usr/bin/env node
// PreToolUse Hook: Constitution Write Guard
// Protects .omc/constitution.md from non-brand-steward writes.

import { existsSync, readFileSync } from 'fs';
import { basename, dirname } from 'path';

const skipHooks = (process.env.OMC_SKIP_HOOKS || '').split(',').map(s => s.trim());
if (process.env.DISABLE_OMC === '1' || skipHooks.includes('constitution-guard')) {
  process.exit(0);
}

async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; process.stdin.destroy(); resolve(Buffer.concat(chunks).toString('utf-8')); }
    }, 1800);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(Buffer.concat(chunks).toString('utf-8')); } });
    process.stdin.on('error', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(''); } });
    if (process.stdin.readableEnded) { if (!settled) { settled = true; clearTimeout(timeout); resolve(''); } }
  });
}

function isConstitutionPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return basename(filePath) === 'constitution.md' && dirname(filePath).endsWith('.omc');
}

function scanTranscriptForIdentity(transcriptPath) {
  if (!transcriptPath) return 'ambiguous';
  try {
    if (!existsSync(transcriptPath)) return 'ambiguous';
    const content = readFileSync(transcriptPath, 'utf-8');
    const last50 = content.split('\n').slice(-50).join('\n');
    if (last50.includes('brand-steward')) return 'brand-steward';
    if (/subagent_type["']?\s*[:=]\s*["']?(?!brand-steward)[a-zA-Z0-9-]/.test(last50)) return 'other';
    return 'ambiguous';
  } catch {
    return 'ambiguous';
  }
}

async function main() {
  try {
    const raw = await readStdin();
    let data = {};
    try { data = JSON.parse(raw); } catch { process.exit(0); }

    const toolName = data.tool_name || data.toolName || '';
    if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) process.exit(0);

    const toolInput = data.tool_input || data.toolInput || {};
    const filePath = toolInput.file_path || toolInput.path || '';
    if (!isConstitutionPath(filePath)) process.exit(0);

    const transcriptPath = data.transcript_path || data.transcriptPath || '';
    const identity = scanTranscriptForIdentity(transcriptPath);

    if (identity === 'brand-steward') {
      process.exit(0);
    } else if (identity === 'other') {
      console.error('[constitution-guard] BLOCKED: Only the brand-steward agent may write to .omc/constitution.md.');
      process.exit(2);
    } else {
      console.error('[constitution-guard] WARNING: Write to .omc/constitution.md — agent identity ambiguous. Allowing with warning.');
      process.exit(0);
    }
  } catch {
    process.exit(0);
  }
}

main();

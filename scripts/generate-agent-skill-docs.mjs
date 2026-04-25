#!/usr/bin/env node

/**
 * Generates agent and skill catalogs from canonical sources.
 *
 * Reads:
 *   - dist/agents/index.js  (canonical agent registry)
 *   - agents/*.md           (filesystem agent prompt files)
 *   - skills/<name>/SKILL.md (filesystem skill manifests)
 *
 * Writes:
 *   - docs/generated/agent-catalog.md
 *   - docs/generated/skill-catalog.md
 *   - docs/generated/counts.json
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const generatedDir = join(root, 'docs', 'generated');

const agentsDir = join(root, 'agents');
const skillsDir = join(root, 'skills');

let registryEntries = {};
try {
  const mod = await import(join(root, 'dist', 'agents', 'index.js'));
  registryEntries = mod.getAgentDefinitions ? mod.getAgentDefinitions() : {};
} catch (error) {
  console.warn(`Warning: could not import dist/agents/index.js (${error.message}). Run "npm run build" first for full agent catalog. Continuing with filesystem-only data.`);
}

const promptFiles = readdirSync(agentsDir)
  .filter((entry) => entry.endsWith('.md') && entry !== 'AGENTS.md')
  .map((entry) => entry.replace(/\.md$/, ''))
  .sort();

const skillNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

const agentRows = promptFiles.map((name) => {
  const reg = registryEntries[name];
  const front = readFrontmatter(join(agentsDir, `${name}.md`));
  return {
    name,
    model: reg?.model ?? front.model ?? '-',
    inRegistry: Boolean(reg),
    description: oneLine(reg?.description ?? front.description ?? ''),
  };
});

const registryOnlyAgents = Object.keys(registryEntries).filter((name) => !promptFiles.includes(name));

const skillRows = skillNames.map((name) => {
  const front = readFrontmatter(join(skillsDir, name, 'SKILL.md'));
  return {
    name,
    level: front.level ?? '-',
    argumentHint: front['argument-hint'] ?? '',
    description: oneLine(front.description ?? ''),
  };
});

mkdirSync(generatedDir, { recursive: true });

writeFileSync(join(generatedDir, 'agent-catalog.md'), renderAgentCatalog(agentRows, registryOnlyAgents), 'utf-8');
writeFileSync(join(generatedDir, 'skill-catalog.md'), renderSkillCatalog(skillRows), 'utf-8');
writeFileSync(
  join(generatedDir, 'counts.json'),
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      agents: {
        registry: Object.keys(registryEntries).length,
        files: promptFiles.length,
        match: Object.keys(registryEntries).length === promptFiles.length && registryOnlyAgents.length === 0,
      },
      skills: {
        files: skillNames.length,
      },
    },
    null,
    2,
  )}\n`,
  'utf-8',
);

console.log(`Generated:`);
console.log(`  ${join('docs', 'generated', 'agent-catalog.md')} (${agentRows.length} agents)`);
console.log(`  ${join('docs', 'generated', 'skill-catalog.md')} (${skillRows.length} skills)`);
console.log(`  ${join('docs', 'generated', 'counts.json')}`);

if (registryOnlyAgents.length > 0) {
  console.warn(`\nWarning: registry has agents missing prompt files: ${registryOnlyAgents.join(', ')}`);
}

const filesystemMissingFromRegistry = promptFiles.filter((name) => !registryEntries[name]);
if (filesystemMissingFromRegistry.length > 0 && Object.keys(registryEntries).length > 0) {
  console.warn(`\nWarning: prompt files missing from registry: ${filesystemMissingFromRegistry.join(', ')}`);
}

function readFrontmatter(path) {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!kv) continue;
    result[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderAgentCatalog(rows, registryOnly) {
  const header = [
    '# Agent Catalog',
    '',
    'Generated from `src/agents/definitions.ts` and `agents/*.md`.',
    'Do not edit by hand. Run `npm run docs:generate` to refresh.',
    '',
    `Total agents (filesystem): ${rows.length}.`,
    '',
    '| Name | Model | In registry | Description |',
    '| --- | --- | --- | --- |',
  ];
  const body = rows.map((row) =>
    `| ${escapeCell(row.name)} | ${escapeCell(row.model)} | ${row.inRegistry ? 'yes' : 'no'} | ${escapeCell(row.description)} |`,
  );
  const trailing = [];
  if (registryOnly.length > 0) {
    trailing.push('', '## Drift', '', `The following names exist in the registry but lack prompt files: ${registryOnly.map((name) => `\`${name}\``).join(', ')}.`);
  }
  return `${[...header, ...body, ...trailing].join('\n')}\n`;
}

function renderSkillCatalog(rows) {
  const header = [
    '# Skill Catalog',
    '',
    'Generated by scanning `skills/<name>/SKILL.md`.',
    'Do not edit by hand. Run `npm run docs:generate` to refresh.',
    '',
    `Total skills (filesystem): ${rows.length}.`,
    '',
    '| Name | Level | Argument hint | Description |',
    '| --- | --- | --- | --- |',
  ];
  const body = rows.map((row) =>
    `| ${escapeCell(row.name)} | ${escapeCell(row.level)} | ${escapeCell(row.argumentHint)} | ${escapeCell(row.description)} |`,
  );
  return `${[...header, ...body].join('\n')}\n`;
}

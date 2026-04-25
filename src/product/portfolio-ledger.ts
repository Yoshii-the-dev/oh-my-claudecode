import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';

export type PortfolioLane =
  | 'product'
  | 'ux'
  | 'research'
  | 'backend'
  | 'quality'
  | 'brand-content'
  | 'distribution';

export type PortfolioStatus =
  | 'candidate'
  | 'selected'
  | 'in_progress'
  | 'done'
  | 'blocked'
  | 'deferred'
  | 'rejected';

export interface PortfolioWorkItem {
  id: string;
  title: string;
  lane: PortfolioLane;
  status: PortfolioStatus;
  confidence: number | 'HIGH' | 'MEDIUM' | 'LOW' | 'high' | 'medium' | 'low';
  dependencies: string[];
  selected_cycle: string | null;
  evidence: string[];
  type?: 'core-product-slice' | 'enabling' | 'learning' | 'research' | 'quality' | 'distribution';
  user_visible?: boolean;
  expected_learning?: string;
  dependency_unlock?: string;
}

export interface PortfolioLedger {
  schema_version: 1;
  updated_at: string;
  source_artifacts: string[];
  items: PortfolioWorkItem[];
}

export interface PortfolioLedgerIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface PortfolioLedgerValidationReport {
  ok: boolean;
  path: string;
  ledger?: PortfolioLedger;
  issues: PortfolioLedgerIssue[];
  summary: {
    items: number;
    selected: number;
    lanes: number;
    errors: number;
    warnings: number;
  };
}

export const PORTFOLIO_LEDGER_RELATIVE_PATH = '.omc/portfolio/current.json';
export const PORTFOLIO_PROJECTION_RELATIVE_PATH = '.omc/portfolio/current.md';
export const OPPORTUNITIES_RELATIVE_PATH = '.omc/opportunities/current.md';

export interface PortfolioMigrationOptions {
  source?: string;
  write?: boolean;
  force?: boolean;
  now?: string;
}

export interface PortfolioMigrationReport {
  ok: boolean;
  sourcePath: string;
  outputPath: string;
  projectionPath?: string;
  wrote: boolean;
  ledger?: PortfolioLedger;
  issues: PortfolioLedgerIssue[];
}

const VALID_LANES: ReadonlySet<string> = new Set<PortfolioLane>([
  'product',
  'ux',
  'research',
  'backend',
  'quality',
  'brand-content',
  'distribution',
]);

const VALID_STATUSES: ReadonlySet<string> = new Set<PortfolioStatus>([
  'candidate',
  'selected',
  'in_progress',
  'done',
  'blocked',
  'deferred',
  'rejected',
]);

export function getPortfolioLedgerPath(root = process.cwd()): string {
  return resolve(root, PORTFOLIO_LEDGER_RELATIVE_PATH);
}

export function readPortfolioLedger(root = process.cwd()): PortfolioLedger | undefined {
  const path = getPortfolioLedgerPath(root);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as PortfolioLedger;
}

export function validatePortfolioLedger(root = process.cwd()): PortfolioLedgerValidationReport {
  const path = getPortfolioLedgerPath(root);
  const issues: PortfolioLedgerIssue[] = [];
  let ledger: PortfolioLedger | undefined;

  if (!existsSync(path)) {
    issues.push({
      severity: 'error',
      code: 'missing-ledger',
      path,
      message: `Missing ${PORTFOLIO_LEDGER_RELATIVE_PATH}`,
    });
    return report(path, ledger, issues);
  }

  try {
    ledger = JSON.parse(readFileSync(path, 'utf-8')) as PortfolioLedger;
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'invalid-json',
      path,
      message: error instanceof Error ? error.message : String(error),
    });
    return report(path, ledger, issues);
  }

  validateLedgerShape(path, ledger, issues);
  return report(path, ledger, issues);
}

export function renderPortfolioProjection(ledger: PortfolioLedger): string {
  const rows = [...ledger.items].sort((a, b) => {
    if (a.selected_cycle && !b.selected_cycle) return -1;
    if (!a.selected_cycle && b.selected_cycle) return 1;
    return `${a.lane}:${a.id}`.localeCompare(`${b.lane}:${b.id}`);
  });

  const table = rows.map((item) => [
    item.id,
    item.lane,
    item.status,
    String(item.confidence),
    item.selected_cycle ?? '',
    item.dependencies.join(', '),
    item.title,
  ]);

  return [
    '# Portfolio Ledger',
    '',
    `schema_version: ${ledger.schema_version}`,
    `updated_at: ${ledger.updated_at}`,
    '',
    '| ID | Lane | Status | Confidence | Selected Cycle | Dependencies | Title |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...table.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
    '',
    '## Source Artifacts',
    ...ledger.source_artifacts.map((source) => `- ${source}`),
    '',
  ].join('\n');
}

export function writePortfolioProjection(root = process.cwd(), path?: string): string {
  const ledger = readPortfolioLedger(root);
  if (!ledger) {
    throw new Error(`Missing ${PORTFOLIO_LEDGER_RELATIVE_PATH}`);
  }
  const outputPath = resolve(root, path ?? PORTFOLIO_PROJECTION_RELATIVE_PATH);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderPortfolioProjection(ledger), 'utf-8');
  return outputPath;
}

export function migrateOpportunitiesToPortfolioLedger(
  root = process.cwd(),
  options: PortfolioMigrationOptions = {},
): PortfolioMigrationReport {
  const resolvedRoot = resolve(root);
  const sourcePath = resolve(resolvedRoot, options.source ?? OPPORTUNITIES_RELATIVE_PATH);
  const outputPath = getPortfolioLedgerPath(resolvedRoot);
  const issues: PortfolioLedgerIssue[] = [];

  if (!existsSync(sourcePath)) {
    issues.push(issue(sourcePath, 'error', 'missing-opportunities', `Missing ${relative(resolvedRoot, sourcePath)}`));
    return { ok: false, sourcePath, outputPath, wrote: false, issues };
  }

  if (options.write && existsSync(outputPath) && !options.force) {
    issues.push(issue(outputPath, 'error', 'ledger-exists', `${PORTFOLIO_LEDGER_RELATIVE_PATH} already exists; pass --force to overwrite`));
    return { ok: false, sourcePath, outputPath, wrote: false, issues };
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const sourceArtifact = relative(resolvedRoot, sourcePath);
  const items = extractPortfolioItemsFromOpportunities(content, sourceArtifact);

  if (items.length === 0) {
    issues.push(issue(sourcePath, 'error', 'no-candidates-found', 'Could not find candidate moves in markdown tables or id: blocks'));
  }

  const cycleId = inferSelectedCycleId(content, options.now);
  applySelectedCycle(content, items, cycleId);

  const ledger: PortfolioLedger = {
    schema_version: 1,
    updated_at: options.now ?? new Date().toISOString(),
    source_artifacts: [sourceArtifact],
    items,
  };

  validateLedgerShape(outputPath, ledger, issues);

  const errors = issues.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    return { ok: false, sourcePath, outputPath, wrote: false, ledger, issues };
  }

  let projectionPath: string | undefined;
  if (options.write) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
    projectionPath = writePortfolioProjection(resolvedRoot);
  }

  return {
    ok: true,
    sourcePath,
    outputPath,
    projectionPath,
    wrote: Boolean(options.write),
    ledger,
    issues,
  };
}

function extractPortfolioItemsFromOpportunities(content: string, sourceArtifact: string): PortfolioWorkItem[] {
  const fromTables = extractItemsFromTables(content, sourceArtifact);
  const fromBlocks = extractItemsFromIdBlocks(content, sourceArtifact);
  return dedupeItems([...fromTables, ...fromBlocks]);
}

function extractItemsFromTables(content: string, sourceArtifact: string): PortfolioWorkItem[] {
  const lines = content.split('\n');
  const items: PortfolioWorkItem[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableRow(lines[index]) || !isMarkdownSeparator(lines[index + 1])) continue;

    const headers = splitMarkdownRow(lines[index]).map(normalizeHeader);
    if (!headers.includes('lane') || !headers.some((header) => ['id', 'candidate', 'move', 'title'].includes(header))) {
      continue;
    }

    let rowIndex = index + 2;
    while (rowIndex < lines.length && isMarkdownTableRow(lines[rowIndex])) {
      if (!isMarkdownSeparator(lines[rowIndex])) {
        const cells = splitMarkdownRow(lines[rowIndex]);
        const item = itemFromCells(headers, cells, sourceArtifact);
        if (item) items.push(item);
      }
      rowIndex += 1;
    }
    index = rowIndex;
  }

  return items;
}

function extractItemsFromIdBlocks(content: string, sourceArtifact: string): PortfolioWorkItem[] {
  const blocks = [...content.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?id:\s*([a-z0-9][a-z0-9-]*)[\s\S]*?(?=\n\s*(?:[-*]\s*)?id:\s*[a-z0-9]|\n#{1,6}\s|$)/gi)];
  return blocks
    .map((match) => {
      const block = match[0];
      const id = match[1];
      const values = parseKeyValueBlock(block);
      return normalizeWorkItem({
        id,
        title: values.title ?? values.name ?? humanizeSlug(id),
        lane: values.lane,
        type: values.type,
        status: values.status,
        confidence: values.confidence,
        dependencies: values.dependencies,
        selected_cycle: values.selectedcycle,
        evidence: values.evidence,
        expected_learning: values.expectedlearning ?? values.learning,
        dependency_unlock: values.dependencyunlock ?? values.unlock,
        user_visible: values.uservisible,
      }, sourceArtifact);
    })
    .filter((item): item is PortfolioWorkItem => Boolean(item));
}

function itemFromCells(headers: string[], cells: string[], sourceArtifact: string): PortfolioWorkItem | undefined {
  const get = (...names: string[]): string | undefined => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0 && cells[index]?.trim()) return cells[index].trim();
    }
    return undefined;
  };

  const rawTitle = get('title', 'candidate', 'move', 'workitem') ?? '';
  const rawId = get('id', 'candidateid', 'moveid') ?? rawTitle;
  if (!rawId && !rawTitle) return undefined;

  return normalizeWorkItem({
    id: slugify(rawId || rawTitle),
    title: rawTitle || humanizeSlug(slugify(rawId)),
    lane: get('lane'),
    type: get('type'),
    status: get('status'),
    confidence: get('confidence'),
    dependencies: get('dependencies', 'dependency', 'depends'),
    selected_cycle: get('selectedcycle', 'cycle'),
    evidence: get('evidence', 'source', 'sources'),
    expected_learning: get('expectedlearning', 'learning'),
    dependency_unlock: get('dependencyunlock', 'unlock'),
    user_visible: get('uservisible'),
  }, sourceArtifact);
}

function normalizeWorkItem(
  input: Record<string, unknown>,
  sourceArtifact: string,
): PortfolioWorkItem | undefined {
  const id = slugify(String(input.id ?? ''));
  if (!id) return undefined;
  const title = String(input.title ?? humanizeSlug(id)).trim() || humanizeSlug(id);
  const lane = normalizeLane(input.lane, `${title} ${input.type ?? ''}`);
  const type = normalizeType(input.type, lane);
  const confidence = normalizeConfidence(input.confidence);
  const evidence = splitList(input.evidence).filter(Boolean);
  const selectedCycle = typeof input.selected_cycle === 'string' && input.selected_cycle.trim()
    ? slugify(input.selected_cycle)
    : null;

  return {
    id,
    title,
    lane,
    type,
    status: normalizeStatus(input.status),
    user_visible: normalizeBoolean(input.user_visible) ?? (
      lane === 'product'
      || lane === 'ux'
      || lane === 'distribution'
      || lane === 'brand-content'
    ),
    confidence,
    dependencies: splitList(input.dependencies).map(slugify).filter(Boolean),
    selected_cycle: selectedCycle,
    evidence: evidence.length > 0 ? evidence : [sourceArtifact],
    expected_learning: typeof input.expected_learning === 'string' && input.expected_learning.trim()
      ? input.expected_learning.trim()
      : 'Migrated from opportunities artifact; refine expected learning on next priority-engine pass.',
    dependency_unlock: typeof input.dependency_unlock === 'string' && input.dependency_unlock.trim()
      ? input.dependency_unlock.trim()
      : 'Migrated from opportunities artifact; refine dependency unlock on next priority-engine pass.',
  };
}

function applySelectedCycle(content: string, items: PortfolioWorkItem[], cycleId: string): void {
  const selectedTargets = extractSelectedTargets(content);
  for (const target of selectedTargets) {
    const match = findBestItemMatch(items, target.text, target.lane);
    if (!match) continue;
    match.status = 'selected';
    match.selected_cycle = cycleId;
    match.type = target.type;
    match.user_visible = target.type === 'core-product-slice' ? true : match.user_visible;
  }

  for (const item of items) {
    if (item.status === 'selected' && !item.selected_cycle) {
      item.selected_cycle = cycleId;
    }
  }
}

function extractSelectedTargets(content: string): Array<{ text: string; type: NonNullable<PortfolioWorkItem['type']>; lane?: PortfolioLane }> {
  const section = content.match(/(?:^|\n)#{1,6}\s*Selected Cycle Portfolio[\s\S]*?(?=\n#{1,6}\s|$)/i)?.[0] ?? content;
  const patterns: Array<{ regex: RegExp; type: NonNullable<PortfolioWorkItem['type']>; lane?: PortfolioLane }> = [
    { regex: /(?:core_product_slice|core product slice|1\s+core product slice)\s*:\s*(.+)/gi, type: 'core-product-slice', lane: 'product' },
    { regex: /(?:enabling_task|enabling task|1\s+enabling task)\s*:\s*(.+)/gi, type: 'enabling', lane: 'backend' },
    { regex: /(?:learning_task|learning\/research task|learning task|1\s+learning\/research task|1\s+learning task)\s*:\s*(.+)/gi, type: 'learning', lane: 'research' },
  ];
  const targets: Array<{ text: string; type: NonNullable<PortfolioWorkItem['type']>; lane?: PortfolioLane }> = [];
  for (const pattern of patterns) {
    for (const match of section.matchAll(pattern.regex)) {
      const text = match[1]?.replace(/^[-*]\s*/, '').trim();
      if (text) targets.push({ text, type: pattern.type, lane: pattern.lane });
    }
  }
  return targets;
}

function findBestItemMatch(
  items: PortfolioWorkItem[],
  text: string,
  preferredLane?: PortfolioLane,
): PortfolioWorkItem | undefined {
  const normalizedText = compactText(text);
  const candidates = preferredLane ? items.filter((item) => item.lane === preferredLane) : items;
  return candidates.find((item) => {
    const title = compactText(item.title);
    return normalizedText.includes(title) || title.includes(normalizedText) || normalizedText.includes(compactText(item.id));
  }) ?? candidates[0];
}

function inferSelectedCycleId(content: string, now?: string): string {
  const explicit = content.match(/cycle_id:\s*([a-z0-9][a-z0-9-]*)/i)?.[1];
  if (explicit) return slugify(explicit);
  const date = content.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? (now ?? new Date().toISOString()).slice(0, 10);
  return `${date}-migrated-portfolio`;
}

function parseKeyValueBlock(block: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(?:[-*]\s*)?([a-z_ -]+)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    values[normalizeHeader(match[1])] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return values;
}

function dedupeItems(items: PortfolioWorkItem[]): PortfolioWorkItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    if (count === 0) return item;
    return { ...item, id: `${item.id}-${count + 1}` };
  });
}

function splitMarkdownRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isMarkdownSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeLane(value: unknown, fallbackText: string): PortfolioLane {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (VALID_LANES.has(normalized)) return normalized as PortfolioLane;
  const lower = `${normalized} ${fallbackText}`.toLowerCase();
  if (lower.includes('ux') || lower.includes('ui') || lower.includes('screen')) return 'ux';
  if (lower.includes('research') || lower.includes('interview') || lower.includes('learning')) return 'research';
  if (lower.includes('backend') || lower.includes('schema') || lower.includes('api') || lower.includes('persistence')) return 'backend';
  if (lower.includes('quality') || lower.includes('test') || lower.includes('a11y')) return 'quality';
  if (lower.includes('brand') || lower.includes('content')) return 'brand-content';
  if (lower.includes('distribution') || lower.includes('seo') || lower.includes('channel')) return 'distribution';
  return 'product';
}

function normalizeStatus(value: unknown): PortfolioStatus {
  const normalized = String(value ?? '').toLowerCase().trim();
  return VALID_STATUSES.has(normalized) ? normalized as PortfolioStatus : 'candidate';
}

function normalizeType(value: unknown, lane: PortfolioLane): PortfolioWorkItem['type'] {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (['core-product-slice', 'enabling', 'learning', 'research', 'quality', 'distribution'].includes(normalized)) {
    return normalized as NonNullable<PortfolioWorkItem['type']>;
  }
  if (lane === 'research') return 'learning';
  if (lane === 'backend') return 'enabling';
  if (lane === 'quality') return 'quality';
  if (lane === 'distribution') return 'distribution';
  return 'core-product-slice';
}

function normalizeConfidence(value: unknown): PortfolioWorkItem['confidence'] {
  const normalized = String(value ?? '').trim();
  if (/^(high|medium|low)$/i.test(normalized)) return normalized.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW';
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : 'MEDIUM';
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (/^(true|yes|1)$/i.test(value.trim())) return true;
  if (/^(false|no|0)$/i.test(value.trim())) return false;
  return undefined;
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[,;]+/)
    .map((entry) => entry.replace(/^["'\s-]+|["'\s]+$/g, '').trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function humanizeSlug(value: string): string {
  return value.split('-').filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function validateLedgerShape(path: string, ledger: PortfolioLedger, issues: PortfolioLedgerIssue[]): void {
  if (ledger.schema_version !== 1) {
    issues.push(issue(path, 'error', 'invalid-schema-version', 'schema_version must be 1'));
  }
  if (!ledger.updated_at || Number.isNaN(Date.parse(ledger.updated_at))) {
    issues.push(issue(path, 'error', 'invalid-updated-at', 'updated_at must be an ISO timestamp'));
  }
  if (!Array.isArray(ledger.source_artifacts)) {
    issues.push(issue(path, 'error', 'invalid-source-artifacts', 'source_artifacts must be an array'));
  }
  if (!Array.isArray(ledger.items)) {
    issues.push(issue(path, 'error', 'invalid-items', 'items must be an array'));
    return;
  }

  const ids = new Set<string>();
  const selectedCycleCount = new Map<string, number>();
  for (const [index, item] of ledger.items.entries()) {
    const itemPath = `${path}#/items/${index}`;
    validateItem(itemPath, item, issues);
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) {
        issues.push(issue(itemPath, 'error', 'duplicate-id', `Duplicate item id: ${item.id}`));
      }
      ids.add(item.id);
    }
    if (item.selected_cycle) {
      selectedCycleCount.set(item.selected_cycle, (selectedCycleCount.get(item.selected_cycle) ?? 0) + 1);
    }
  }

  for (const [cycle, count] of selectedCycleCount.entries()) {
    if (count > 3) {
      issues.push(issue(path, 'warning', 'large-selected-cycle', `Cycle ${cycle} has ${count} selected items; expected core/enabling/learning trio`));
    }
  }
}

function validateItem(path: string, item: PortfolioWorkItem, issues: PortfolioLedgerIssue[]): void {
  if (!item || typeof item !== 'object') {
    issues.push(issue(path, 'error', 'invalid-item', 'Portfolio item must be an object'));
    return;
  }
  if (!item.id || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
    issues.push(issue(path, 'error', 'invalid-id', 'id must be kebab-case and stable'));
  }
  if (!item.title || typeof item.title !== 'string') {
    issues.push(issue(path, 'error', 'missing-title', 'title is required'));
  }
  if (!VALID_LANES.has(item.lane)) {
    issues.push(issue(path, 'error', 'invalid-lane', `lane must be one of: ${[...VALID_LANES].join(', ')}`));
  }
  if (!VALID_STATUSES.has(item.status)) {
    issues.push(issue(path, 'error', 'invalid-status', `status must be one of: ${[...VALID_STATUSES].join(', ')}`));
  }
  if (!isValidConfidence(item.confidence)) {
    issues.push(issue(path, 'error', 'invalid-confidence', 'confidence must be HIGH/MEDIUM/LOW or number 0..1'));
  }
  if (!Array.isArray(item.dependencies)) {
    issues.push(issue(path, 'error', 'invalid-dependencies', 'dependencies must be an array'));
  }
  if (!(item.selected_cycle === null || typeof item.selected_cycle === 'string')) {
    issues.push(issue(path, 'error', 'invalid-selected-cycle', 'selected_cycle must be string or null'));
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    issues.push(issue(path, 'error', 'missing-evidence', 'evidence must be a non-empty array'));
  }
}

function isValidConfidence(value: PortfolioWorkItem['confidence']): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1;
  return ['HIGH', 'MEDIUM', 'LOW', 'high', 'medium', 'low'].includes(value);
}

function report(
  path: string,
  ledger: PortfolioLedger | undefined,
  issues: PortfolioLedgerIssue[],
): PortfolioLedgerValidationReport {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const items = ledger?.items ?? [];
  return {
    ok: errors === 0,
    path,
    ledger,
    issues,
    summary: {
      items: items.length,
      selected: items.filter((item) => Boolean(item.selected_cycle)).length,
      lanes: new Set(items.map((item) => item.lane)).size,
      errors,
      warnings,
    },
  };
}

function issue(
  path: string,
  severity: PortfolioLedgerIssue['severity'],
  code: string,
  message: string,
): PortfolioLedgerIssue {
  return { severity, code, path, message };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

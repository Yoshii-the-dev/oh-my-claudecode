import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';

export type CycleStage =
  | 'discover'
  | 'rank'
  | 'select'
  | 'spec'
  | 'build'
  | 'verify'
  | 'learn'
  | 'complete'
  | 'blocked';

export interface CycleStandardFooter {
  status: string;
  evidence: string[];
  confidence: number | string;
  blocking_issues: string[];
  next_action: string;
  artifacts_written: string[];
}

export interface CycleSelectedPortfolio {
  core_product_slice: string;
  enabling_task: string;
  learning_task: string;
}

export interface CycleSpec {
  acceptance_criteria: string[];
  build_route: 'product-pipeline' | 'backend-pipeline' | 'both' | 'blocked';
  verification_plan: string[];
  learning_plan: string[];
  experience_gate?: string;
}

export interface CycleStageEvent {
  stage: CycleStage;
  at: string;
  note?: string;
}

export interface CycleDocument {
  schema_version: 1;
  cycle_id: string;
  cycle_goal: string;
  cycle_stage: CycleStage;
  product_stage: string;
  stage_checklist: Record<Exclude<CycleStage, 'complete' | 'blocked'>, boolean>;
  selected_portfolio: CycleSelectedPortfolio;
  spec: CycleSpec;
  footer: CycleStandardFooter;
  history: CycleStageEvent[];
  updated_at: string;
}

export interface CycleDocumentIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface CycleDocumentValidationReport {
  ok: boolean;
  path: string;
  document?: CycleDocument;
  issues: CycleDocumentIssue[];
}

export interface CycleMigrationOptions {
  source?: string;
  write?: boolean;
  force?: boolean;
  now?: string;
}

export interface CycleMigrationReport {
  ok: boolean;
  sourcePath: string;
  jsonPath: string;
  projectionPath?: string;
  wrote: boolean;
  document?: CycleDocument;
  issues: CycleDocumentIssue[];
}

export const CYCLE_DOCUMENT_RELATIVE_PATH = '.omc/cycles/current.json';
export const CYCLE_PROJECTION_RELATIVE_PATH = '.omc/cycles/current.md';

const VALID_STAGES = new Set<CycleStage>([
  'discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn', 'complete', 'blocked',
]);

const VALID_BUILD_ROUTES = new Set<CycleSpec['build_route']>([
  'product-pipeline', 'backend-pipeline', 'both', 'blocked',
]);

const CHECKLIST_STAGES: Array<Exclude<CycleStage, 'complete' | 'blocked'>> = [
  'discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn',
];

export function getCycleDocumentPath(root = process.cwd()): string {
  return resolve(root, CYCLE_DOCUMENT_RELATIVE_PATH);
}

export function getCycleProjectionPath(root = process.cwd()): string {
  return resolve(root, CYCLE_PROJECTION_RELATIVE_PATH);
}

export function readCycleDocument(root = process.cwd()): CycleDocument | undefined {
  const jsonPath = getCycleDocumentPath(root);
  if (!existsSync(jsonPath)) return undefined;
  return JSON.parse(readFileSync(jsonPath, 'utf-8')) as CycleDocument;
}

export function validateCycleDocument(root = process.cwd()): CycleDocumentValidationReport {
  const path = getCycleDocumentPath(root);
  const issues: CycleDocumentIssue[] = [];
  if (!existsSync(path)) {
    issues.push({ severity: 'error', code: 'missing-document', path, message: `Missing ${CYCLE_DOCUMENT_RELATIVE_PATH}` });
    return { ok: false, path, issues };
  }

  let document: CycleDocument | undefined;
  try {
    document = JSON.parse(readFileSync(path, 'utf-8')) as CycleDocument;
  } catch (error) {
    issues.push({ severity: 'error', code: 'invalid-json', path, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, path, issues };
  }

  validateDocumentShape(path, document, issues);
  return { ok: !issues.some((entry) => entry.severity === 'error'), path, document, issues };
}

export function writeCycleDocument(root: string, doc: CycleDocument): { jsonPath: string; projectionPath: string } {
  const jsonPath = getCycleDocumentPath(root);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  const projectionPath = writeCycleProjection(root, doc);
  return { jsonPath, projectionPath };
}

export function writeCycleProjection(root: string, document?: CycleDocument): string {
  const doc = document ?? readCycleDocument(root);
  if (!doc) throw new Error(`Missing ${CYCLE_DOCUMENT_RELATIVE_PATH}`);
  const projectionPath = getCycleProjectionPath(root);
  mkdirSync(dirname(projectionPath), { recursive: true });
  writeFileSync(projectionPath, renderCycleProjection(doc), 'utf-8');
  return projectionPath;
}

export function renderCycleProjection(doc: CycleDocument): string {
  const checklist = CHECKLIST_STAGES.map((stage) => `- [${doc.stage_checklist[stage] ? 'x' : ' '}] ${stage}`).join('\n');
  const acceptance = doc.spec.acceptance_criteria.map((entry) => `  - ${entry}`).join('\n');
  const verification = doc.spec.verification_plan.map((entry) => `  - ${entry}`).join('\n');
  const learning = doc.spec.learning_plan.map((entry) => `  - ${entry}`).join('\n');
  const evidence = doc.footer.evidence.map((entry) => `  - ${entry}`).join('\n');
  const blocking = doc.footer.blocking_issues.length === 0
    ? '  - []'
    : doc.footer.blocking_issues.map((entry) => `  - ${entry}`).join('\n');
  const artifacts = doc.footer.artifacts_written.map((entry) => `  - ${entry}`).join('\n');
  const history = doc.history.length === 0
    ? '_no recorded transitions yet_'
    : doc.history.map((event) => `- ${event.at} ${event.stage}${event.note ? ` — ${event.note}` : ''}`).join('\n');

  return `# Product Cycle: ${doc.cycle_goal}

cycle_id: ${doc.cycle_id}
cycle_goal: ${doc.cycle_goal}
cycle_stage: ${doc.cycle_stage}
product_stage: ${doc.product_stage}
schema_source: ${CYCLE_DOCUMENT_RELATIVE_PATH}
updated_at: ${doc.updated_at}

## Stage Checklist
${checklist}

## Selected Cycle Portfolio
core_product_slice: ${doc.selected_portfolio.core_product_slice}
enabling_task: ${doc.selected_portfolio.enabling_task}
learning_task: ${doc.selected_portfolio.learning_task}

## Cycle Spec
acceptance_criteria:
${acceptance}
build_route: ${doc.spec.build_route}
verification_plan:
${verification}
learning_plan:
${learning}
experience_gate: ${doc.spec.experience_gate ?? '.omc/experience/current.md'}

## History
${history}

status: ${doc.footer.status}
evidence:
${evidence}
confidence: ${doc.footer.confidence}
blocking_issues:
${blocking}
next_action: ${doc.footer.next_action}
artifacts_written:
${artifacts}
`;
}

export function migrateCycleMarkdownToJson(root = process.cwd(), options: CycleMigrationOptions = {}): CycleMigrationReport {
  const resolvedRoot = resolve(root);
  const sourcePath = resolve(resolvedRoot, options.source ?? CYCLE_PROJECTION_RELATIVE_PATH);
  const jsonPath = getCycleDocumentPath(resolvedRoot);
  const issues: CycleDocumentIssue[] = [];

  if (!existsSync(sourcePath)) {
    issues.push({ severity: 'error', code: 'missing-source', path: sourcePath, message: `Missing ${relative(resolvedRoot, sourcePath)}` });
    return { ok: false, sourcePath, jsonPath, wrote: false, issues };
  }

  if (options.write && existsSync(jsonPath) && !options.force) {
    issues.push({ severity: 'error', code: 'json-exists', path: jsonPath, message: `${CYCLE_DOCUMENT_RELATIVE_PATH} already exists; pass --force to overwrite` });
    return { ok: false, sourcePath, jsonPath, wrote: false, issues };
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const document = parseCycleMarkdown(content, options.now);
  validateDocumentShape(jsonPath, document, issues);
  const errors = issues.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    return { ok: false, sourcePath, jsonPath, wrote: false, document, issues };
  }

  let projectionPath: string | undefined;
  if (options.write) {
    const result = writeCycleDocument(resolvedRoot, document);
    projectionPath = result.projectionPath;
  }

  return { ok: true, sourcePath, jsonPath, projectionPath, wrote: Boolean(options.write), document, issues };
}

export function parseCycleMarkdown(content: string, now?: string): CycleDocument {
  const fields = parseTopLevelFields(content);
  const cycleStage = normalizeStage(fields.cycle_stage);
  const cycleId = fields.cycle_id ?? deriveCycleId(fields.cycle_goal ?? readHeadingGoal(content) ?? 'product cycle', now);
  const cycleGoal = readHeadingGoal(content) ?? fields.cycle_goal ?? cycleId;

  const checklist = parseChecklist(content);
  const portfolio = parsePortfolioSection(content, fields);
  const spec = parseSpecSection(content, fields);
  const footer = parseFooterSection(content);
  const history = parseHistorySection(content);

  return {
    schema_version: 1,
    cycle_id: cycleId,
    cycle_goal: cycleGoal,
    cycle_stage: cycleStage,
    product_stage: fields.product_stage ?? 'pre-mvp',
    stage_checklist: checklist,
    selected_portfolio: portfolio,
    spec,
    footer,
    history,
    updated_at: now ?? new Date().toISOString(),
  };
}

function parseTopLevelFields(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([a-z_]+):\s*(.+?)\s*$/i);
    if (!match) continue;
    if (out[match[1]] !== undefined) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

function readHeadingGoal(content: string): string | undefined {
  const match = content.match(/^#\s+Product Cycle:\s*(.+?)\s*$/im);
  return match?.[1]?.trim();
}

function parseChecklist(content: string): CycleDocument['stage_checklist'] {
  const result = Object.fromEntries(CHECKLIST_STAGES.map((stage) => [stage, false])) as CycleDocument['stage_checklist'];
  for (const stage of CHECKLIST_STAGES) {
    const pattern = new RegExp(`^- \\[([ xX])\\] ${stage}\\s*$`, 'm');
    const match = content.match(pattern);
    if (match) result[stage] = match[1].toLowerCase() === 'x';
  }
  return result;
}

function parsePortfolioSection(content: string, fields: Record<string, string>): CycleSelectedPortfolio {
  const section = sectionContent(content, /Selected Cycle Portfolio/i);
  const find = (key: string): string => {
    const match = (section ?? content).match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
    return match?.[1]?.trim() ?? fields[key] ?? '';
  };
  return {
    core_product_slice: find('core_product_slice'),
    enabling_task: find('enabling_task'),
    learning_task: find('learning_task'),
  };
}

function parseSpecSection(content: string, fields: Record<string, string>): CycleSpec {
  const section = sectionContent(content, /Cycle Spec/i) ?? content;
  return {
    acceptance_criteria: parseList(section, 'acceptance_criteria'),
    build_route: normalizeBuildRoute(matchValue(section, 'build_route') ?? fields.build_route),
    verification_plan: parseList(section, 'verification_plan'),
    learning_plan: parseList(section, 'learning_plan'),
    experience_gate: matchValue(section, 'experience_gate') ?? fields.experience_gate,
  };
}

function parseFooterSection(content: string): CycleStandardFooter {
  const status = matchValue(content, 'status') ?? 'unknown';
  const confidence = parseConfidence(matchValue(content, 'confidence'));
  const evidence = parseList(content, 'evidence');
  const blocking = parseList(content, 'blocking_issues').filter((entry) => entry.toLowerCase() !== 'none');
  const nextAction = matchValue(content, 'next_action') ?? '';
  const artifacts = parseList(content, 'artifacts_written');
  return {
    status,
    confidence,
    evidence,
    blocking_issues: blocking,
    next_action: nextAction,
    artifacts_written: artifacts,
  };
}

function parseHistorySection(content: string): CycleStageEvent[] {
  const section = sectionContent(content, /^History$/im);
  if (!section) return [];
  const events: CycleStageEvent[] = [];
  for (const line of section.split('\n')) {
    const match = line.match(/^- (\S+)\s+([a-z]+)(?:\s+—\s+(.+))?$/);
    if (!match) continue;
    const stage = normalizeStage(match[2]);
    if (stage === 'complete' || stage === 'blocked') {
      events.push({ stage, at: match[1], note: match[3] });
    } else if (CHECKLIST_STAGES.includes(stage as Exclude<CycleStage, 'complete' | 'blocked'>)) {
      events.push({ stage, at: match[1], note: match[3] });
    }
  }
  return events;
}

function sectionContent(content: string, header: RegExp): string | undefined {
  const headerString = header.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\$$/, '$');
  const pattern = new RegExp(`(?:^|\\n)#{1,6}\\s*${headerString}([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, header.flags.includes('i') ? 'i' : '');
  const match = content.match(pattern);
  return match?.[1]?.trim();
}

function matchValue(section: string, key: string): string | undefined {
  const match = section.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}

function parseList(section: string, key: string): string[] {
  const result: string[] = [];
  const inline = section.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  if (inline && !inline[1].trim().match(/^[-*]/) && !inline[1].trim().match(/^$/) && inline[1].trim() !== '') {
    if (!isListIntroducer(inline[1])) {
      const value = inline[1].replace(/^['"]|['"]$/g, '').trim();
      if (value && value !== '[]' && value !== 'none') result.push(value);
    }
  }
  const blockMatch = section.match(new RegExp(`^\\s*${key}:\\s*\\n((?:^\\s+[-*].*\\n?)+)`, 'im'));
  if (blockMatch) {
    for (const line of blockMatch[1].split('\n')) {
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (!item) continue;
      const value = item[1].trim();
      if (!value || value === '[]') continue;
      result.push(value);
    }
  }
  return Array.from(new Set(result));
}

function isListIntroducer(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '|' || trimmed.endsWith(':');
}

function parseConfidence(value: string | undefined): number | string {
  if (!value) return 'unknown';
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return value;
}

function normalizeStage(value: string | undefined): CycleStage {
  const lower = (value ?? '').toLowerCase().trim();
  return VALID_STAGES.has(lower as CycleStage) ? (lower as CycleStage) : 'discover';
}

function normalizeBuildRoute(value: string | undefined): CycleSpec['build_route'] {
  const lower = (value ?? '').toLowerCase().trim();
  return VALID_BUILD_ROUTES.has(lower as CycleSpec['build_route']) ? (lower as CycleSpec['build_route']) : 'blocked';
}

function deriveCycleId(goal: string, now?: string): string {
  const date = (now ?? new Date().toISOString()).slice(0, 10);
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'cycle';
  return `${date}-${slug}`;
}

function validateDocumentShape(path: string, document: CycleDocument, issues: CycleDocumentIssue[]): void {
  if (document.schema_version !== 1) {
    issues.push({ severity: 'error', code: 'invalid-schema-version', path, message: 'schema_version must be 1' });
  }
  if (!document.cycle_id || !/^[a-z0-9][a-z0-9-]*$/.test(document.cycle_id)) {
    issues.push({ severity: 'error', code: 'invalid-cycle-id', path, message: 'cycle_id must be kebab-case and stable' });
  }
  if (!VALID_STAGES.has(document.cycle_stage)) {
    issues.push({ severity: 'error', code: 'invalid-stage', path, message: `cycle_stage must be one of ${[...VALID_STAGES].join(', ')}` });
  }
  if (!document.spec || !VALID_BUILD_ROUTES.has(document.spec.build_route)) {
    issues.push({ severity: 'error', code: 'invalid-build-route', path, message: 'spec.build_route must be a valid route' });
  }
  if (!document.selected_portfolio
    || typeof document.selected_portfolio.core_product_slice !== 'string'
    || typeof document.selected_portfolio.enabling_task !== 'string'
    || typeof document.selected_portfolio.learning_task !== 'string') {
    issues.push({ severity: 'error', code: 'invalid-portfolio', path, message: 'selected_portfolio must include core_product_slice, enabling_task, learning_task' });
  }
  if (!document.footer || typeof document.footer.status !== 'string') {
    issues.push({ severity: 'error', code: 'invalid-footer', path, message: 'footer.status is required' });
  } else if (!Array.isArray(document.footer.evidence)) {
    issues.push({ severity: 'error', code: 'invalid-evidence', path, message: 'footer.evidence must be an array' });
  } else if (!Array.isArray(document.footer.artifacts_written)) {
    issues.push({ severity: 'error', code: 'invalid-artifacts-written', path, message: 'footer.artifacts_written must be an array' });
  }
  if (!Array.isArray(document.history)) {
    issues.push({ severity: 'error', code: 'invalid-history', path, message: 'history must be an array' });
  }
  if (document.cycle_stage === 'complete' && !document.history.some((entry) => entry.stage === 'learn')) {
    issues.push({ severity: 'warning', code: 'complete-without-learn-event', path, message: 'cycle_stage=complete with no learn event in history' });
  }
}

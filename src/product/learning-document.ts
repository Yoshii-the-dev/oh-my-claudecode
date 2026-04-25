import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';

export interface LearningStandardFooter {
  status: string;
  evidence: string[];
  confidence: number | string;
  blocking_issues: string[];
  next_action: string;
  artifacts_written: string[];
}

export interface LearningDocument {
  schema_version: 1;
  cycle_id: string;
  shipped_outcome: string;
  evidence_collected: string[];
  user_product_learning: string[];
  invalidated_assumptions: string[];
  recommended_next_cycle: string;
  next_candidate_adjustments: string[];
  footer: LearningStandardFooter;
  captured_at: string;
}

export interface LearningDocumentIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface LearningDocumentValidationReport {
  ok: boolean;
  path: string;
  document?: LearningDocument;
  issues: LearningDocumentIssue[];
}

export interface LearningMigrationOptions {
  source?: string;
  write?: boolean;
  force?: boolean;
  now?: string;
  cycleId?: string;
}

export interface LearningMigrationReport {
  ok: boolean;
  sourcePath: string;
  jsonPath: string;
  projectionPath?: string;
  wrote: boolean;
  document?: LearningDocument;
  issues: LearningDocumentIssue[];
}

export const LEARNING_DOCUMENT_RELATIVE_PATH = '.omc/learning/current.json';
export const LEARNING_PROJECTION_RELATIVE_PATH = '.omc/learning/current.md';

export function getLearningDocumentPath(root = process.cwd()): string {
  return resolve(root, LEARNING_DOCUMENT_RELATIVE_PATH);
}

export function getLearningProjectionPath(root = process.cwd()): string {
  return resolve(root, LEARNING_PROJECTION_RELATIVE_PATH);
}

export function readLearningDocument(root = process.cwd()): LearningDocument | undefined {
  const path = getLearningDocumentPath(root);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as LearningDocument;
}

export function validateLearningDocument(root = process.cwd()): LearningDocumentValidationReport {
  const path = getLearningDocumentPath(root);
  const issues: LearningDocumentIssue[] = [];
  if (!existsSync(path)) {
    issues.push({ severity: 'error', code: 'missing-document', path, message: `Missing ${LEARNING_DOCUMENT_RELATIVE_PATH}` });
    return { ok: false, path, issues };
  }
  let document: LearningDocument | undefined;
  try {
    document = JSON.parse(readFileSync(path, 'utf-8')) as LearningDocument;
  } catch (error) {
    issues.push({ severity: 'error', code: 'invalid-json', path, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, path, issues };
  }

  validateDocumentShape(path, document, issues);
  return { ok: !issues.some((entry) => entry.severity === 'error'), path, document, issues };
}

export function writeLearningDocument(root: string, doc: LearningDocument): { jsonPath: string; projectionPath: string } {
  const jsonPath = getLearningDocumentPath(root);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  const projectionPath = writeLearningProjection(root, doc);
  return { jsonPath, projectionPath };
}

export function writeLearningProjection(root: string, document?: LearningDocument): string {
  const doc = document ?? readLearningDocument(root);
  if (!doc) throw new Error(`Missing ${LEARNING_DOCUMENT_RELATIVE_PATH}`);
  const projectionPath = getLearningProjectionPath(root);
  mkdirSync(dirname(projectionPath), { recursive: true });
  writeFileSync(projectionPath, renderLearningProjection(doc), 'utf-8');
  return projectionPath;
}

export function renderLearningProjection(doc: LearningDocument): string {
  const evidence = bulletList(doc.evidence_collected);
  const userLearning = bulletList(doc.user_product_learning);
  const assumptions = bulletList(doc.invalidated_assumptions);
  const adjustments = bulletList(doc.next_candidate_adjustments);
  const footerEvidence = bulletList(doc.footer.evidence);
  const blocking = doc.footer.blocking_issues.length === 0
    ? '  - []'
    : doc.footer.blocking_issues.map((entry) => `  - ${entry}`).join('\n');
  const artifacts = bulletList(doc.footer.artifacts_written);

  return `# Learning: ${doc.cycle_id}

cycle_id: ${doc.cycle_id}
schema_source: ${LEARNING_DOCUMENT_RELATIVE_PATH}
captured_at: ${doc.captured_at}

## Shipped outcome
${doc.shipped_outcome.trim() || '_pending_'}

## Evidence collected
${evidence}

## User/product learning
${userLearning}

## Invalidated assumptions
${assumptions}

## Recommended next cycle
${doc.recommended_next_cycle.trim() || '_pending_'}

## Next candidate adjustments
${adjustments}

status: ${doc.footer.status}
evidence:
${footerEvidence}
confidence: ${doc.footer.confidence}
blocking_issues:
${blocking}
next_action: ${doc.footer.next_action}
artifacts_written:
${artifacts}
`;
}

export function migrateLearningMarkdownToJson(root = process.cwd(), options: LearningMigrationOptions = {}): LearningMigrationReport {
  const resolvedRoot = resolve(root);
  const sourcePath = resolve(resolvedRoot, options.source ?? LEARNING_PROJECTION_RELATIVE_PATH);
  const jsonPath = getLearningDocumentPath(resolvedRoot);
  const issues: LearningDocumentIssue[] = [];

  if (!existsSync(sourcePath)) {
    issues.push({ severity: 'error', code: 'missing-source', path: sourcePath, message: `Missing ${relative(resolvedRoot, sourcePath)}` });
    return { ok: false, sourcePath, jsonPath, wrote: false, issues };
  }

  if (options.write && existsSync(jsonPath) && !options.force) {
    issues.push({ severity: 'error', code: 'json-exists', path: jsonPath, message: `${LEARNING_DOCUMENT_RELATIVE_PATH} already exists; pass --force to overwrite` });
    return { ok: false, sourcePath, jsonPath, wrote: false, issues };
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const document = parseLearningMarkdown(content, options);
  validateDocumentShape(jsonPath, document, issues);
  const errors = issues.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    return { ok: false, sourcePath, jsonPath, wrote: false, document, issues };
  }

  let projectionPath: string | undefined;
  if (options.write) {
    const result = writeLearningDocument(resolvedRoot, document);
    projectionPath = result.projectionPath;
  }

  return { ok: true, sourcePath, jsonPath, projectionPath, wrote: Boolean(options.write), document, issues };
}

export function parseLearningMarkdown(content: string, options: LearningMigrationOptions = {}): LearningDocument {
  const cycleId = options.cycleId ?? matchValue(content, 'cycle_id') ?? deriveCycleIdFromHeading(content);
  const shippedOutcome = sectionParagraph(content, 'Shipped outcome') ?? '';
  const recommendedNextCycle = sectionParagraph(content, 'Recommended next cycle') ?? '';
  const evidence = sectionList(content, 'Evidence collected');
  const userLearning = sectionList(content, 'User\\/product learning');
  const assumptions = sectionList(content, 'Invalidated assumptions');
  const adjustments = sectionList(content, 'Next candidate adjustments');

  return {
    schema_version: 1,
    cycle_id: cycleId,
    shipped_outcome: shippedOutcome.trim(),
    evidence_collected: evidence,
    user_product_learning: userLearning,
    invalidated_assumptions: assumptions,
    recommended_next_cycle: recommendedNextCycle.trim(),
    next_candidate_adjustments: adjustments,
    footer: parseFooter(content),
    captured_at: options.now ?? new Date().toISOString(),
  };
}

function parseFooter(content: string): LearningStandardFooter {
  return {
    status: matchValue(content, 'status') ?? 'unknown',
    confidence: parseConfidence(matchValue(content, 'confidence')),
    evidence: parseList(content, 'evidence'),
    blocking_issues: parseList(content, 'blocking_issues').filter((entry) => entry.toLowerCase() !== 'none'),
    next_action: matchValue(content, 'next_action') ?? '',
    artifacts_written: parseList(content, 'artifacts_written'),
  };
}

function deriveCycleIdFromHeading(content: string): string {
  const heading = content.match(/^#\s+Learning:\s*([a-z0-9][a-z0-9-]*)/im);
  if (heading) return heading[1];
  const dated = content.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return `${dated?.[1] ?? '0000-00-00'}-learning`;
}

function sectionParagraph(content: string, header: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\n)#{1,6}\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|\\nstatus:|$)`, 'i');
  return content.match(pattern)?.[1]?.trim();
}

function sectionList(content: string, header: string): string[] {
  const section = sectionParagraph(content, header);
  if (!section) return [];
  const lines = section.split('\n');
  const result: string[] = [];
  let buffer = '';
  for (const line of lines) {
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      if (buffer) result.push(buffer.trim());
      buffer = item[1];
    } else if (buffer && line.trim().length > 0) {
      buffer += ` ${line.trim()}`;
    } else if (buffer && line.trim().length === 0) {
      result.push(buffer.trim());
      buffer = '';
    } else if (!buffer && line.trim().length > 0) {
      buffer = line.trim();
    }
  }
  if (buffer) result.push(buffer.trim());
  return result.filter((entry) => entry && entry !== '[]');
}

function matchValue(section: string, key: string): string | undefined {
  const match = section.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}

function parseList(content: string, key: string): string[] {
  const out: string[] = [];
  const inline = content.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'im'));
  if (inline && inline[1] && !inline[1].endsWith(':')) {
    const value = inline[1].replace(/^['"]|['"]$/g, '').trim();
    if (value && value !== '[]' && value !== 'none' && !value.match(/^[-*]/)) out.push(value);
  }
  const block = content.match(new RegExp(`^\\s*${key}:\\s*\\n((?:^\\s+[-*].*\\n?)+)`, 'im'));
  if (block) {
    for (const line of block[1].split('\n')) {
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (!item) continue;
      const value = item[1].trim();
      if (!value || value === '[]') continue;
      out.push(value);
    }
  }
  return Array.from(new Set(out));
}

function bulletList(items: string[]): string {
  if (items.length === 0) return '_none recorded_';
  return items.map((entry) => `- ${entry}`).join('\n');
}

function parseConfidence(value: string | undefined): number | string {
  if (!value) return 'unknown';
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return value;
}

function validateDocumentShape(path: string, document: LearningDocument, issues: LearningDocumentIssue[]): void {
  if (document.schema_version !== 1) {
    issues.push({ severity: 'error', code: 'invalid-schema-version', path, message: 'schema_version must be 1' });
  }
  if (!document.cycle_id || !/^[a-z0-9][a-z0-9-]*$/.test(document.cycle_id)) {
    issues.push({ severity: 'error', code: 'invalid-cycle-id', path, message: 'cycle_id must be kebab-case and reference an existing cycle' });
  }
  if (!document.shipped_outcome.trim()) {
    issues.push({ severity: 'error', code: 'missing-shipped-outcome', path, message: 'shipped_outcome must not be empty' });
  }
  if (!Array.isArray(document.evidence_collected)) {
    issues.push({ severity: 'error', code: 'invalid-evidence-collected', path, message: 'evidence_collected must be an array' });
  }
  if (!Array.isArray(document.user_product_learning)) {
    issues.push({ severity: 'error', code: 'invalid-user-product-learning', path, message: 'user_product_learning must be an array' });
  }
  if (!Array.isArray(document.invalidated_assumptions)) {
    issues.push({ severity: 'error', code: 'invalid-invalidated-assumptions', path, message: 'invalidated_assumptions must be an array' });
  }
  if (!document.recommended_next_cycle.trim()) {
    issues.push({ severity: 'warning', code: 'missing-recommended-next-cycle', path, message: 'recommended_next_cycle is empty' });
  }
}

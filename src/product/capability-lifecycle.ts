import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import {
  PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
  generateProductTotalityAudit,
  type ProductTotalityCapability,
  type ProductTotalityReport,
} from './product-totality.js';
import {
  PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH,
  generateProductScenarioCoverageAudit,
  type ProductScenarioCoverageReport,
  type ProductScenarioCoverageScenario,
} from './scenario-coverage.js';
import {
  PRODUCT_REGRESSION_JSON_RELATIVE_PATH,
  generateProductRegressionAudit,
  type ProductRegressionDebt,
  type ProductRegressionReport,
} from './product-regression.js';

export const PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH = '.omc/product/capability-lifecycle/current.json';
export const PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH = '.omc/product/capability-lifecycle/current.md';

export type ProductCapabilityLifecycleStatus =
  | 'empty'
  | 'needs-triage'
  | 'needs-proof'
  | 'needs-connection'
  | 'healthy';

export type ProductCapabilityLifecycleStage =
  | 'seeded'
  | 'proving'
  | 'connected'
  | 'mature'
  | 'deprecated'
  | 'remove-candidate';

export type ProductCapabilityLifecycleDecision =
  | 'develop-depth'
  | 'prove'
  | 'connect'
  | 'retain'
  | 'deprecate'
  | 'remove-or-redesign';

export interface ProductCapabilityLifecycleItem {
  capability_id: string;
  title: string;
  source_cycle: string;
  stage: ProductCapabilityLifecycleStage;
  decision: ProductCapabilityLifecycleDecision;
  maturity: ProductTotalityCapability['maturity'];
  scenario_coverage: ProductScenarioCoverageScenario['coverage'] | 'none';
  connection_count: number;
  missing_depth_count: number;
  regression_debt_count: number;
  error_debt_count: number;
  orphan: boolean;
  reasons: string[];
  recommended_action: string;
  evidence: string[];
}

export interface ProductCapabilityLifecycleReport {
  schema_version: 1;
  generated_at: string;
  root: string;
  status: ProductCapabilityLifecycleStatus;
  source_artifacts: string[];
  aggregates: {
    capability_count: number;
    seeded: number;
    proving: number;
    connected: number;
    mature: number;
    deprecated: number;
    remove_candidates: number;
    error_debt_capabilities: number;
  };
  capabilities: ProductCapabilityLifecycleItem[];
  next_action: string;
}

export interface ProductCapabilityLifecycleOptions {
  root?: string;
  totality?: ProductTotalityReport;
  scenarioCoverage?: ProductScenarioCoverageReport;
  regression?: ProductRegressionReport;
  now?: Date;
}

export function generateProductCapabilityLifecycleAudit(
  options: ProductCapabilityLifecycleOptions = {},
): ProductCapabilityLifecycleReport {
  const root = resolve(options.root ?? process.cwd());
  const totality = options.totality ?? generateProductTotalityAudit(root);
  const scenarioCoverage = options.scenarioCoverage ?? generateProductScenarioCoverageAudit({ root, totality });
  const regression = options.regression ?? generateProductRegressionAudit({ root, totality, scenarioCoverage });
  const lifecycleContext = readLifecycleContext(root);
  const items = totality.capabilities.map((capability) => lifecycleItem(
    capability,
    totality,
    scenarioCoverage,
    regression,
    lifecycleContext,
  ));
  const status = determineStatus(items);
  const sourceArtifacts = Array.from(new Set([
    PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
    PRODUCT_SCENARIO_COVERAGE_JSON_RELATIVE_PATH,
    PRODUCT_REGRESSION_JSON_RELATIVE_PATH,
    ...totality.source_artifacts,
    ...scenarioCoverage.source_artifacts,
    ...regression.source_artifacts,
    ...lifecycleContext.sources,
  ])).sort();

  return {
    schema_version: 1,
    generated_at: (options.now ?? new Date()).toISOString(),
    root,
    status,
    source_artifacts: sourceArtifacts,
    aggregates: {
      capability_count: items.length,
      seeded: items.filter((item) => item.stage === 'seeded').length,
      proving: items.filter((item) => item.stage === 'proving').length,
      connected: items.filter((item) => item.stage === 'connected').length,
      mature: items.filter((item) => item.stage === 'mature').length,
      deprecated: items.filter((item) => item.stage === 'deprecated').length,
      remove_candidates: items.filter((item) => item.stage === 'remove-candidate').length,
      error_debt_capabilities: items.filter((item) => item.error_debt_count > 0).length,
    },
    capabilities: items,
    next_action: nextAction(status),
  };
}

export function writeProductCapabilityLifecycleAudit(
  root = process.cwd(),
  report = generateProductCapabilityLifecycleAudit({ root }),
): { jsonPath: string; mdPath: string } {
  const resolvedRoot = resolve(root);
  const jsonPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH);
  const mdPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_LIFECYCLE_MD_RELATIVE_PATH);
  mkdirSync(dirname(jsonPath), { recursive: true });
  atomicWriteJsonSync(jsonPath, report);
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, renderProductCapabilityLifecycleAudit(report), 'utf-8');
  return { jsonPath, mdPath };
}

export function renderProductCapabilityLifecycleAudit(report: ProductCapabilityLifecycleReport): string {
  const rows = report.capabilities.map((capability) => (
    `| ${escapeCell(capability.capability_id)} | ${capability.stage} | ${capability.decision} | ${escapeCell(capability.title)} | ${capability.scenario_coverage} | ${capability.missing_depth_count} | ${capability.regression_debt_count} |`
  ));
  const actionRows = report.capabilities
    .filter((capability) => capability.stage !== 'mature')
    .map((capability) => (
      `| ${capability.stage} | ${escapeCell(capability.title)} | ${escapeCell(capability.recommended_action)} |`
    ));

  return [
    '# Product Capability Lifecycle',
    '',
    `status: ${report.status}`,
    `generated_at: ${report.generated_at}`,
    `schema_source: ${PRODUCT_CAPABILITY_LIFECYCLE_JSON_RELATIVE_PATH}`,
    '',
    '## Aggregates',
    `- capability_count: ${report.aggregates.capability_count}`,
    `- seeded: ${report.aggregates.seeded}`,
    `- proving: ${report.aggregates.proving}`,
    `- connected: ${report.aggregates.connected}`,
    `- mature: ${report.aggregates.mature}`,
    `- deprecated: ${report.aggregates.deprecated}`,
    `- remove_candidates: ${report.aggregates.remove_candidates}`,
    `- error_debt_capabilities: ${report.aggregates.error_debt_capabilities}`,
    '',
    '## Lifecycle',
    '| Capability | Stage | Decision | Title | Scenario | Missing Depth | Debts |',
    '| --- | --- | --- | --- | --- | ---: | ---: |',
    ...(rows.length > 0 ? rows : ['| none | seeded | develop-depth | No completed capabilities yet | none | 0 | 0 |']),
    '',
    '## Actions',
    '| Stage | Capability | Recommended Action |',
    '| --- | --- | --- |',
    ...(actionRows.length > 0 ? actionRows : ['| mature | product | No lifecycle actions required |']),
    '',
    '## Source Artifacts',
    ...report.source_artifacts.map((source) => `- ${source}`),
    '',
    `next_action: ${report.next_action}`,
    '',
  ].join('\n');
}

interface LifecycleContext {
  text: string;
  sources: string[];
}

function lifecycleItem(
  capability: ProductTotalityCapability,
  totality: ProductTotalityReport,
  scenarioCoverage: ProductScenarioCoverageReport,
  regression: ProductRegressionReport,
  lifecycleContext: LifecycleContext,
): ProductCapabilityLifecycleItem {
  const scenario = scenarioCoverage.scenarios.find((entry) => entry.capability_id === capability.id);
  const debts = regression.debts.filter((debt) => debtAppliesToCapability(debt, capability));
  const orphan = totality.capability_graph.orphan_capabilities.some((entry) => entry.capability_id === capability.id);
  const deprecated = lifecycleContextMentions(lifecycleContext.text, capability, ['deprecated', 'deprecate', 'sunset']);
  const removeMarked = lifecycleContextMentions(lifecycleContext.text, capability, [
    'remove-candidate',
    'remove candidate',
    'remove-or-redesign',
    'remove/merge/redesign',
    'rewrite',
  ]);
  const stage = determineCapabilityStage({
    capability,
    scenario,
    debts,
    orphan,
    deprecated,
    removeMarked,
  });
  const reasons = lifecycleReasons({ capability, scenario, debts, orphan, deprecated, removeMarked });
  const decision = decisionForStage(stage);
  const action = recommendedActionForStage(stage, capability, scenario);

  return {
    capability_id: capability.id,
    title: capability.title,
    source_cycle: capability.source_cycle,
    stage,
    decision,
    maturity: capability.maturity,
    scenario_coverage: scenario?.coverage ?? 'none',
    connection_count: capability.connections.length,
    missing_depth_count: capability.missing_depth.length,
    regression_debt_count: debts.length,
    error_debt_count: debts.filter((debt) => debt.severity === 'error').length,
    orphan,
    reasons,
    recommended_action: action,
    evidence: Array.from(new Set([
      capability.source_path,
      ...capability.evidence,
      ...(scenario?.evidence ?? []),
      ...debts.flatMap((debt) => debt.evidence),
    ])).filter(Boolean),
  };
}

function determineCapabilityStage(input: {
  capability: ProductTotalityCapability;
  scenario: ProductScenarioCoverageScenario | undefined;
  debts: ProductRegressionDebt[];
  orphan: boolean;
  deprecated: boolean;
  removeMarked: boolean;
}): ProductCapabilityLifecycleStage {
  const errorDebt = input.debts.some((debt) => debt.severity === 'error');
  const scenarioCoverage = input.scenario?.coverage;
  const scenarioPassed = scenarioCoverage === 'runtime-passed';
  const weakOrIsolated = input.orphan || input.capability.connections.length === 0;
  const depthMissing = input.capability.missing_depth.length > 0;

  if (input.deprecated) return 'deprecated';
  if (input.removeMarked) return 'remove-candidate';
  if (
    weakOrIsolated
    && !scenarioPassed
    && (errorDebt || input.capability.maturity === 'missing-expectation' || depthMissing)
  ) {
    return 'remove-candidate';
  }
  if (input.capability.maturity === 'systemic-v2' && scenarioPassed && !errorDebt && !input.orphan) return 'mature';
  if (!scenarioPassed && input.capability.maturity !== 'missing-expectation') return 'proving';
  if (input.capability.connections.length >= 2 && !errorDebt) return 'connected';
  return 'seeded';
}

function lifecycleReasons(input: {
  capability: ProductTotalityCapability;
  scenario: ProductScenarioCoverageScenario | undefined;
  debts: ProductRegressionDebt[];
  orphan: boolean;
  deprecated: boolean;
  removeMarked: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.deprecated) reasons.push('roadmap or portfolio marks this capability deprecated');
  if (input.removeMarked) reasons.push('roadmap or portfolio marks this capability for removal/rewrite');
  if (input.orphan) reasons.push('capability graph marks this as orphaned');
  if (!input.scenario) reasons.push('no scenario coverage entry');
  else if (input.scenario.coverage !== 'runtime-passed') reasons.push(`scenario coverage is ${input.scenario.coverage}`);
  if (input.capability.maturity === 'missing-expectation') reasons.push('missing feature expectation contract');
  if (input.capability.missing_depth.length > 0) reasons.push(`${input.capability.missing_depth.length} maturity/depth item(s) missing`);
  if (input.capability.connections.length === 0) reasons.push('no product/context/learning connections');
  if (input.debts.length > 0) reasons.push(`${input.debts.length} regression debt item(s) apply`);
  if (reasons.length === 0) reasons.push('capability has current lifecycle evidence');
  return reasons;
}

function decisionForStage(stage: ProductCapabilityLifecycleStage): ProductCapabilityLifecycleDecision {
  if (stage === 'mature') return 'retain';
  if (stage === 'connected') return 'connect';
  if (stage === 'proving') return 'prove';
  if (stage === 'deprecated') return 'deprecate';
  if (stage === 'remove-candidate') return 'remove-or-redesign';
  return 'develop-depth';
}

function recommendedActionForStage(
  stage: ProductCapabilityLifecycleStage,
  capability: ProductTotalityCapability,
  scenario: ProductScenarioCoverageScenario | undefined,
): string {
  if (stage === 'mature') return 'Treat as stable product foundation; avoid re-selecting unless a new learning signal appears.';
  if (stage === 'deprecated') return 'Keep out of selected cycle unless explicitly reviving with a new expectation contract.';
  if (stage === 'remove-candidate') return 'Remove, merge, or redesign this capability around a real user loop before adding more surface area.';
  if (stage === 'proving') return scenario
    ? scenario.recommended_action
    : `Generate and run a scenario for ${capability.title} before treating it as complete.`;
  if (stage === 'connected') return 'Keep connected in roadmap, then add the smallest missing v1/v2 maturity depth.';
  return 'Treat as a seeded capability: add v1/v2 depth and scenario proof before calling it done.';
}

function determineStatus(items: ProductCapabilityLifecycleItem[]): ProductCapabilityLifecycleStatus {
  if (items.length === 0) return 'empty';
  if (items.some((item) => item.stage === 'remove-candidate' || item.stage === 'deprecated')) return 'needs-triage';
  if (items.some((item) => item.stage === 'proving')) return 'needs-proof';
  if (items.some((item) => item.stage === 'seeded' || item.orphan)) return 'needs-connection';
  return 'healthy';
}

function nextAction(status: ProductCapabilityLifecycleStatus): string {
  if (status === 'empty') return 'Complete a product-cycle, then run omc capability-lifecycle audit --write';
  if (status === 'needs-triage') return 'Resolve remove/deprecate candidates before selecting unrelated new work';
  if (status === 'needs-proof') return 'Run scenario proof or dogfood evidence for proving capabilities';
  if (status === 'needs-connection') return 'Feed seeded and orphaned capabilities into priority-engine as depth/connection work';
  return 'Capability lifecycle is healthy; prioritize new work against mature foundations';
}

function debtAppliesToCapability(debt: ProductRegressionDebt, capability: ProductTotalityCapability): boolean {
  if (debt.source_cycle && debt.source_cycle === capability.source_cycle) return true;
  const haystack = normalize(`${debt.id} ${debt.subject} ${debt.message} ${debt.recommended_action}`);
  return lifecycleKeywords(`${capability.id} ${capability.title} ${capability.user_job ?? ''} ${capability.first_meaningful_use ?? ''}`)
    .some((token) => haystack.includes(token));
}

function readLifecycleContext(root: string): LifecycleContext {
  const candidates = [
    '.omc/portfolio/current.json',
    '.omc/roadmap/current.md',
    '.omc/opportunities/current.md',
  ];
  const present: string[] = [];
  const text = candidates.flatMap((relativePath) => {
    const path = resolve(root, relativePath);
    if (!existsSync(path)) return [];
    present.push(relativePath);
    try {
      return [readFileSync(path, 'utf-8')];
    } catch {
      return [];
    }
  }).join('\n');
  return { text, sources: present };
}

function lifecycleContextMentions(
  text: string,
  capability: ProductTotalityCapability,
  markers: string[],
): boolean {
  const normalizedMarkers = markers.map(normalize);
  if (!normalizedMarkers.some((marker) => normalize(text).includes(marker))) return false;
  const tokens = lifecycleKeywords(`${capability.id} ${capability.title}`);
  const phrases = Array.from(new Set([capability.id, capability.title]
    .map(normalize)
    .filter((phrase) => phrase.length > 3)));

  return localLifecycleWindows(text).some((window) => (
    normalizedMarkers.some((marker) => window.includes(marker))
    && (phrases.some((phrase) => window.includes(phrase)) || tokens.some((token) => window.includes(token)))
  ));
}

function localLifecycleWindows(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.length <= 1000);
  return [...lines, ...paragraphs].map(normalize).filter((window) => window.length > 0);
}

function lifecycleKeywords(value: string): string[] {
  return Array.from(new Set(normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 3 && !LIFECYCLE_STOP_WORDS.has(token))))
    .slice(0, 12);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const LIFECYCLE_STOP_WORDS = new Set([
  'with',
  'from',
  'that',
  'this',
  'into',
  'user',
  'users',
  'cycle',
  'feature',
  'capability',
  'product',
  'first',
  'loop',
  'able',
  'without',
  'current',
  'state',
  'next',
]);

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

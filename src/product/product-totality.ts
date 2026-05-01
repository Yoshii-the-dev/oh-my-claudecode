import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
import {
  PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH,
  PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH,
  buildProductCapabilityGraphSnapshot,
  writeProductCapabilityGraphAudit,
  type ProductCapabilityGraphSnapshot,
} from './capability-graph.js';
import {
  CYCLE_DOCUMENT_RELATIVE_PATH,
  CYCLE_PROJECTION_RELATIVE_PATH,
  parseCycleMarkdown,
  type CycleDocument,
  type CycleFeatureExpectationContract,
} from './cycle-document.js';
import {
  LEARNING_DOCUMENT_RELATIVE_PATH,
  LEARNING_PROJECTION_RELATIVE_PATH,
  parseLearningMarkdown,
  type LearningDocument,
} from './learning-document.js';
import {
  PORTFOLIO_LEDGER_RELATIVE_PATH,
  readPortfolioLedger,
  type PortfolioLedger,
  type PortfolioWorkItem,
} from './portfolio-ledger.js';

export const PRODUCT_TOTALITY_JSON_RELATIVE_PATH = '.omc/product/totality/current.json';
export const PRODUCT_TOTALITY_MD_RELATIVE_PATH = '.omc/product/totality/current.md';

export type ProductTotalityStatus =
  | 'empty'
  | 'under-composed'
  | 'under-connected'
  | 'needs-depth'
  | 'balanced';

export type ProductTotalityMaturity =
  | 'missing-expectation'
  | 'seeded-v0'
  | 'contextual-v1'
  | 'systemic-v2';

export interface ProductTotalityScore {
  value: number;
  status: 'good' | 'warn' | 'bad' | 'unknown';
  detail: string;
}

export interface ProductTotalityCapability {
  id: string;
  title: string;
  source_cycle: string;
  source_path: string;
  maturity: ProductTotalityMaturity;
  user_job?: string;
  first_meaningful_use?: string;
  implemented_as: string;
  missing_depth: string[];
  connections: string[];
  evidence: string[];
  risks: string[];
}

export interface ProductTotalityGap {
  severity: 'warning' | 'error';
  code: string;
  subject: string;
  message: string;
  recommended_action: string;
}

export interface ProductTotalityRecommendedMove {
  id: string;
  title: string;
  lane: 'product' | 'ux' | 'research' | 'backend' | 'quality' | 'brand-content' | 'distribution';
  type: 'core-product-slice' | 'enabling' | 'learning' | 'research' | 'quality' | 'distribution';
  why: string;
  evidence: string[];
}

export interface ProductTotalityReport {
  schema_version: 1;
  generated_at: string;
  root: string;
  status: ProductTotalityStatus;
  source_artifacts: string[];
  aggregates: {
    completed_cycles: number;
    learning_captures: number;
    seeded_capabilities: number;
    supporting_systems: number;
    portfolio_items: number;
    active_or_selected_items: number;
    lanes: string[];
  };
  scores: {
    composition: ProductTotalityScore;
    connectedness: ProductTotalityScore;
    freedom: ProductTotalityScore;
    depth: ProductTotalityScore;
    complexity_fit: ProductTotalityScore;
    beauty_fit: ProductTotalityScore;
  };
  capability_graph: ProductCapabilityGraphSnapshot;
  capabilities: ProductTotalityCapability[];
  gaps: ProductTotalityGap[];
  recommended_moves: ProductTotalityRecommendedMove[];
  next_action: string;
}

interface RawCycleDocument {
  document: CycleDocument;
  sourcePath: string;
  sourceRelativePath: string;
  source: 'json' | 'markdown';
}

interface RawLearningDocument {
  document: LearningDocument;
  sourcePath: string;
  sourceRelativePath: string;
}

const STOP_WORDS = new Set([
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
]);

export function generateProductTotalityAudit(root = process.cwd()): ProductTotalityReport {
  const resolvedRoot = resolve(root);
  const cycles = collectCycleDocuments(resolvedRoot);
  const learning = collectLearningDocuments(resolvedRoot);
  const learningByCycle = new Map(learning.map((entry) => [entry.document.cycle_id, entry]));
  const portfolio = safeReadPortfolio(resolvedRoot);
  const context = readContextArtifacts(resolvedRoot);
  const completedCycles = cycles.filter((entry) => entry.document.cycle_stage === 'complete');
  const capabilities = completedCycles.map((entry) => buildCapability(entry, learningByCycle.get(entry.document.cycle_id), portfolio, context));
  const supportingSystems = countSupportingSystems(completedCycles, portfolio);
  const lanes = new Set((portfolio?.items ?? []).map((item) => item.lane));
  const activeOrSelectedItems = (portfolio?.items ?? []).filter((item) => (
    item.status === 'selected' || item.status === 'in_progress' || item.status === 'done'
  ));
  const capabilityGraph = buildProductCapabilityGraphSnapshot(capabilities);
  const gaps = buildGaps(capabilities, completedCycles, learningByCycle, portfolio, context, capabilityGraph);
  const recommendedMoves = buildRecommendedMoves(capabilities, gaps, capabilityGraph);
  const scores = buildScores({
    capabilities,
    capabilityGraph,
    supportingSystems,
    lanes: [...lanes],
    portfolioItems: portfolio?.items.length ?? 0,
    activeOrSelectedItems: activeOrSelectedItems.length,
  });
  const status = determineStatus(capabilities, gaps, scores);
  const sourceArtifacts = Array.from(new Set([
    ...cycles.map((entry) => entry.sourceRelativePath),
    ...learning.map((entry) => entry.sourceRelativePath),
    ...(portfolio ? [PORTFOLIO_LEDGER_RELATIVE_PATH] : []),
    ...context.sources,
  ])).sort();

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    root: resolvedRoot,
    status,
    source_artifacts: sourceArtifacts,
    aggregates: {
      completed_cycles: completedCycles.length,
      learning_captures: learning.length,
      seeded_capabilities: capabilities.length,
      supporting_systems: supportingSystems,
      portfolio_items: portfolio?.items.length ?? 0,
      active_or_selected_items: activeOrSelectedItems.length,
      lanes: [...lanes].sort(),
    },
    scores,
    capability_graph: capabilityGraph,
    capabilities,
    gaps,
    recommended_moves: recommendedMoves,
    next_action: nextAction(status, gaps),
  };
}

export function writeProductTotalityAudit(root = process.cwd(), report = generateProductTotalityAudit(root)): {
  jsonPath: string;
  mdPath: string;
  capabilityGraphJsonPath: string;
  capabilityGraphMdPath: string;
} {
  const resolvedRoot = resolve(root);
  const jsonPath = resolve(resolvedRoot, PRODUCT_TOTALITY_JSON_RELATIVE_PATH);
  const mdPath = resolve(resolvedRoot, PRODUCT_TOTALITY_MD_RELATIVE_PATH);
  mkdirSync(dirname(jsonPath), { recursive: true });
  atomicWriteJsonSync(jsonPath, report);
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, renderProductTotalityAudit(report), 'utf-8');
  const graphWritten = writeProductCapabilityGraphAudit(resolvedRoot, report.capability_graph, {
    generatedAt: report.generated_at,
    sourceTotality: PRODUCT_TOTALITY_JSON_RELATIVE_PATH,
    sourceArtifacts: report.source_artifacts,
  });
  return {
    jsonPath,
    mdPath,
    capabilityGraphJsonPath: graphWritten.jsonPath,
    capabilityGraphMdPath: graphWritten.mdPath,
  };
}

export function renderProductTotalityAudit(report: ProductTotalityReport): string {
  const scoreRows = Object.entries(report.scores).map(([name, score]) => (
    `| ${name} | ${score.status} | ${score.value.toFixed(2)} | ${escapeCell(score.detail)} |`
  ));
  const capabilityRows = report.capabilities.map((capability) => (
    `| ${escapeCell(capability.id)} | ${escapeCell(capability.maturity)} | ${escapeCell(capability.title)} | ${capability.connections.length} | ${capability.missing_depth.length} |`
  ));
  const gapRows = report.gaps.map((gap) => (
    `| ${gap.severity} | ${gap.code} | ${escapeCell(gap.subject)} | ${escapeCell(gap.recommended_action)} |`
  ));
  const moveRows = report.recommended_moves.map((move) => (
    `| ${escapeCell(move.id)} | ${move.lane} | ${move.type} | ${escapeCell(move.title)} |`
  ));
  const orphanRows = report.capability_graph.orphan_capabilities.map((orphan) => (
    `| ${escapeCell(orphan.capability_id)} | ${orphan.severity} | ${orphan.score.toFixed(2)} | ${escapeCell(orphan.reasons.join('; '))} |`
  ));

  return [
    '# Product Totality Audit',
    '',
    `status: ${report.status}`,
    `generated_at: ${report.generated_at}`,
    `schema_source: ${PRODUCT_TOTALITY_JSON_RELATIVE_PATH}`,
    '',
    '## Aggregate Product Body',
    `- completed_cycles: ${report.aggregates.completed_cycles}`,
    `- learning_captures: ${report.aggregates.learning_captures}`,
    `- seeded_capabilities: ${report.aggregates.seeded_capabilities}`,
    `- supporting_systems: ${report.aggregates.supporting_systems}`,
    `- portfolio_items: ${report.aggregates.portfolio_items}`,
    `- active_or_selected_items: ${report.aggregates.active_or_selected_items}`,
    `- lanes: ${report.aggregates.lanes.join(', ') || 'none'}`,
    '',
    '## Capability Graph',
    `- graph_schema: ${PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH}`,
    `- graph_projection: ${PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH}`,
    `- nodes: ${report.capability_graph.nodes.length}`,
    `- edges: ${report.capability_graph.edges.length}`,
    `- capability_edges: ${report.capability_graph.aggregates.capability_edge_count}`,
    `- orphan_capabilities: ${report.capability_graph.aggregates.orphan_count}`,
    `- average_capability_degree: ${report.capability_graph.aggregates.average_capability_degree.toFixed(2)}`,
    '',
    '## Compositional Scores',
    '| Dimension | Status | Score | Detail |',
    '| --- | --- | ---: | --- |',
    ...scoreRows,
    '',
    '## Capability Maturity',
    '| Capability | Maturity | Title | Connections | Missing Depth Items |',
    '| --- | --- | --- | ---: | ---: |',
    ...(capabilityRows.length > 0 ? capabilityRows : ['| none | empty | No completed capability cycles yet | 0 | 0 |']),
    '',
    '## Gaps',
    '| Severity | Code | Subject | Recommended Action |',
    '| --- | --- | --- | --- |',
    ...(gapRows.length > 0 ? gapRows : ['| warning | none | product | No current gaps detected by this heuristic audit |']),
    '',
    '## Orphan Capabilities',
    '| Capability | Severity | Score | Reasons |',
    '| --- | --- | ---: | --- |',
    ...(orphanRows.length > 0 ? orphanRows : ['| none | warning | 0.00 | No orphan capabilities detected |']),
    '',
    '## Recommended Portfolio Moves',
    '| ID | Lane | Type | Title |',
    '| --- | --- | --- | --- |',
    ...(moveRows.length > 0 ? moveRows : ['| none | product | core-product-slice | No generated moves |']),
    '',
    '## Source Artifacts',
    ...report.source_artifacts.map((source) => `- ${source}`),
    '',
    `next_action: ${report.next_action}`,
    '',
  ].join('\n');
}

function collectCycleDocuments(root: string): RawCycleDocument[] {
  const cyclesDir = resolve(root, '.omc/cycles');
  if (!existsSync(cyclesDir)) return [];

  const byId = new Map<string, RawCycleDocument>();
  for (const entry of safeList(cyclesDir)) {
    if (!entry.endsWith('.json') && !entry.endsWith('.md')) continue;
    const path = join(cyclesDir, entry);
    if (!safeStat(path)?.isFile()) continue;
    const parsed = entry.endsWith('.json')
      ? parseCycleJson(root, path)
      : parseCycleProjection(root, path);
    if (!parsed) continue;
    const existing = byId.get(parsed.document.cycle_id);
    if (!existing || (parsed.source === 'json' && existing.source === 'markdown')) {
      byId.set(parsed.document.cycle_id, parsed);
    }
  }

  return [...byId.values()].sort((a, b) => a.document.cycle_id.localeCompare(b.document.cycle_id));
}

function collectLearningDocuments(root: string): RawLearningDocument[] {
  const learningDir = resolve(root, '.omc/learning');
  if (!existsSync(learningDir)) return [];

  const byId = new Map<string, RawLearningDocument>();
  for (const entry of safeList(learningDir)) {
    if (!entry.endsWith('.json') && !entry.endsWith('.md')) continue;
    const path = join(learningDir, entry);
    if (!safeStat(path)?.isFile()) continue;
    const document = entry.endsWith('.json')
      ? parseJson<LearningDocument>(path)
      : parseLearningMarkdown(safeRead(path));
    if (!document?.cycle_id) continue;
    const existing = byId.get(document.cycle_id);
    const sourceRelativePath = normalizeRelative(root, path);
    if (!existing || entry.endsWith('.json')) {
      byId.set(document.cycle_id, { document, sourcePath: path, sourceRelativePath });
    }
  }
  return [...byId.values()].sort((a, b) => a.document.cycle_id.localeCompare(b.document.cycle_id));
}

function parseCycleJson(root: string, path: string): RawCycleDocument | undefined {
  const document = parseJson<CycleDocument>(path);
  if (!document?.cycle_id) return undefined;
  return {
    document,
    sourcePath: path,
    sourceRelativePath: normalizeRelative(root, path),
    source: 'json',
  };
}

function parseCycleProjection(root: string, path: string): RawCycleDocument | undefined {
  const content = safeRead(path);
  if (!content.trim()) return undefined;
  const document = parseCycleMarkdown(content);
  if (!document.cycle_id) return undefined;
  return {
    document,
    sourcePath: path,
    sourceRelativePath: normalizeRelative(root, path),
    source: 'markdown',
  };
}

function buildCapability(
  entry: RawCycleDocument,
  learning: RawLearningDocument | undefined,
  portfolio: PortfolioLedger | undefined,
  context: ProductContext,
): ProductTotalityCapability {
  const contract = entry.document.spec.feature_expectation_contract;
  const title = entry.document.selected_portfolio.core_product_slice || entry.document.cycle_goal;
  const id = slugify(title || entry.document.cycle_id);
  const portfolioMatches = findPortfolioMatches(title, portfolio);
  const connections = capabilityConnections(title, entry.document, learning, portfolioMatches, context);
  const missingDepth = missingDepthItems(contract, title, portfolio, context);
  const risks = capabilityRisks(entry.document, contract, learning, connections, context);

  return {
    id,
    title,
    source_cycle: entry.document.cycle_id,
    source_path: entry.sourceRelativePath,
    maturity: inferMaturity(contract, missingDepth),
    user_job: contract?.user_job,
    first_meaningful_use: contract?.first_meaningful_use,
    implemented_as: contract?.maturity_ladder.v0 ?? (entry.document.spec.acceptance_criteria.join('; ') || 'completed cycle output'),
    missing_depth: missingDepth,
    connections,
    evidence: Array.from(new Set([
      entry.sourceRelativePath,
      ...(learning ? [learning.sourceRelativePath] : []),
      ...entry.document.footer.evidence,
      ...portfolioMatches.flatMap((item) => item.evidence),
    ])).filter(Boolean),
    risks,
  };
}

function safeReadPortfolio(root: string): PortfolioLedger | undefined {
  try {
    return readPortfolioLedger(root);
  } catch {
    return undefined;
  }
}

interface ProductContext {
  text: string;
  sources: string[];
  hasRoadmap: boolean;
  hasEcosystem: boolean;
  hasMeaning: boolean;
  hasVisualExpectation: boolean;
  hasTasteGatePass: boolean;
}

function readContextArtifacts(root: string): ProductContext {
  const candidates = [
    '.omc/roadmap/current.md',
    '.omc/opportunities/current.md',
    '.omc/ecosystem/current.md',
    '.omc/meaning/current.md',
    '.omc/experience/current.md',
    '.omc/design/visual-expectation/current.json',
    '.omc/design/taste-gate/current.md',
  ];
  const present = candidates.filter((path) => existsSync(resolve(root, path)));
  const text = present.map((path) => safeRead(resolve(root, path))).join('\n\n');
  return {
    text,
    sources: present,
    hasRoadmap: present.includes('.omc/roadmap/current.md'),
    hasEcosystem: present.includes('.omc/ecosystem/current.md'),
    hasMeaning: present.includes('.omc/meaning/current.md'),
    hasVisualExpectation: present.includes('.omc/design/visual-expectation/current.json'),
    hasTasteGatePass: /verdict:\s*pass|taste[^.\n]*pass/i.test(text),
  };
}

function capabilityConnections(
  title: string,
  cycle: CycleDocument,
  learning: RawLearningDocument | undefined,
  portfolioMatches: PortfolioWorkItem[],
  context: ProductContext,
): string[] {
  const connections: string[] = [];
  if (learning) connections.push(`learning:${learning.sourceRelativePath}`);
  for (const item of portfolioMatches) connections.push(`portfolio:${item.id}`);
  if (context.hasRoadmap && mentions(context.text, title)) connections.push('roadmap');
  if (context.hasEcosystem) connections.push('ecosystem');
  if (context.hasMeaning) connections.push('meaning');
  if ((cycle.spec.build_route === 'product-pipeline' || cycle.spec.build_route === 'both') && context.hasVisualExpectation) {
    connections.push('visual-expectation');
  }
  if ((cycle.spec.build_route === 'product-pipeline' || cycle.spec.build_route === 'both') && context.hasTasteGatePass) {
    connections.push('taste-gate');
  }
  return Array.from(new Set(connections));
}

function missingDepthItems(
  contract: CycleFeatureExpectationContract | undefined,
  title: string,
  portfolio: PortfolioLedger | undefined,
  context: ProductContext,
): string[] {
  if (!contract) return ['missing feature expectation contract'];
  const missing: string[] = [];
  if (!isDepthRepresented(title, contract.maturity_ladder.v1, portfolio, context)) {
    missing.push(`v1: ${contract.maturity_ladder.v1}`);
  }
  if (!isDepthRepresented(title, contract.maturity_ladder.v2, portfolio, context)) {
    missing.push(`v2: ${contract.maturity_ladder.v2}`);
  }
  for (const gate of contract.not_done_until) {
    if (!containsDepthPhrase(context.text, gate)) missing.push(`not_done_until: ${gate}`);
  }
  return missing;
}

function isDepthRepresented(
  title: string,
  depthText: string,
  portfolio: PortfolioLedger | undefined,
  context: ProductContext,
): boolean {
  if (!depthText.trim()) return false;
  if (containsDepthPhrase(context.text, depthText)) return true;
  return (portfolio?.items ?? []).some((item) => containsDepthPhrase(
    `${item.title} ${item.expected_learning ?? ''} ${item.dependency_unlock ?? ''}`,
    depthText,
  ));
}

function capabilityRisks(
  cycle: CycleDocument,
  contract: CycleFeatureExpectationContract | undefined,
  learning: RawLearningDocument | undefined,
  connections: string[],
  context: ProductContext,
): string[] {
  const risks: string[] = [];
  if (!contract) risks.push('completed capability lacks feature expectation; cannot distinguish seed from finished feature');
  if (!learning) risks.push('completed capability lacks matching learning capture');
  if (connections.length < 2) risks.push('capability appears isolated from roadmap/ecosystem/learning context');
  if ((cycle.spec.build_route === 'product-pipeline' || cycle.spec.build_route === 'both') && !context.hasVisualExpectation) {
    risks.push('user-facing capability lacks current visual expectation evidence');
  }
  if ((cycle.spec.build_route === 'product-pipeline' || cycle.spec.build_route === 'both') && !context.hasTasteGatePass) {
    risks.push('user-facing capability lacks passing taste gate evidence');
  }
  return risks;
}

function inferMaturity(
  contract: CycleFeatureExpectationContract | undefined,
  missingDepth: string[],
): ProductTotalityMaturity {
  if (!contract) return 'missing-expectation';
  const missingV1 = missingDepth.some((entry) => entry.startsWith('v1:'));
  const missingV2 = missingDepth.some((entry) => entry.startsWith('v2:'));
  if (!missingV2) return 'systemic-v2';
  if (!missingV1) return 'contextual-v1';
  return 'seeded-v0';
}

function buildGaps(
  capabilities: ProductTotalityCapability[],
  completedCycles: RawCycleDocument[],
  learningByCycle: Map<string, RawLearningDocument>,
  portfolio: PortfolioLedger | undefined,
  context: ProductContext,
  capabilityGraph: ProductCapabilityGraphSnapshot,
): ProductTotalityGap[] {
  const gaps: ProductTotalityGap[] = [];
  if (completedCycles.length === 0) {
    gaps.push({
      severity: 'warning',
      code: 'no-completed-cycles',
      subject: 'product',
      message: 'No completed product cycle exists yet, so existing work cannot be evaluated as a product body.',
      recommended_action: 'Complete one product-cycle with learning capture, then rerun omc product-totality audit --write.',
    });
  }

  for (const cycle of completedCycles) {
    if (!learningByCycle.has(cycle.document.cycle_id)) {
      gaps.push({
        severity: 'error',
        code: 'completed-without-learning',
        subject: cycle.document.cycle_id,
        message: 'A completed cycle has no matching learning artifact.',
        recommended_action: 'Write or migrate .omc/learning/current.{json,md} and archive it under the cycle id.',
      });
    }
  }

  for (const capability of capabilities) {
    if (capability.maturity === 'missing-expectation') {
      gaps.push({
        severity: 'error',
        code: 'missing-feature-expectation',
        subject: capability.title,
        message: 'A completed capability does not say what it should become beyond the shipped control.',
        recommended_action: 'Backfill feature_expectation_contract, then create v1/v2 portfolio depth moves.',
      });
    }
    if (capability.missing_depth.length > 0) {
      gaps.push({
        severity: 'warning',
        code: 'seeded-capability-needs-depth',
        subject: capability.title,
        message: 'The capability exists as a seed, but its deeper maturity ladder is not represented as current work.',
        recommended_action: 'Add v1/v2 depth moves to .omc/portfolio/current.json and keep them visible in .omc/roadmap/current.md.',
      });
    }
  }

  for (const orphan of capabilityGraph.orphan_capabilities) {
    gaps.push({
      severity: orphan.severity,
      code: 'orphan-capability',
      subject: orphan.title,
      message: `Capability graph flags this capability as under-connected: ${orphan.reasons.join('; ')}.`,
      recommended_action: orphan.recommended_action,
    });
  }

  const infraItems = (portfolio?.items ?? []).filter((item) => item.lane === 'backend' || item.lane === 'quality' || item.type === 'enabling');
  const userItems = (portfolio?.items ?? []).filter((item) => item.user_visible === true || item.type === 'core-product-slice' || item.lane === 'product' || item.lane === 'ux');
  if (infraItems.length > userItems.length + 2) {
    gaps.push({
      severity: 'warning',
      code: 'infrastructure-outruns-product-body',
      subject: 'portfolio',
      message: 'Infrastructure/supporting work is growing faster than user-visible capability depth.',
      recommended_action: 'Select the next core slice from capability depth, not another enabling-only task.',
    });
  }

  if (capabilities.some((capability) => capability.risks.some((risk) => risk.includes('visual expectation'))) && !context.hasVisualExpectation) {
    gaps.push({
      severity: 'warning',
      code: 'visual-form-not-audited',
      subject: 'visual system',
      message: 'User-facing completed work lacks a current visual expectation contract.',
      recommended_action: 'Run /creative-loop for the product body, then omc creative-loop audit --write.',
    });
  }

  return gaps;
}

function buildRecommendedMoves(
  capabilities: ProductTotalityCapability[],
  gaps: ProductTotalityGap[],
  capabilityGraph: ProductCapabilityGraphSnapshot,
): ProductTotalityRecommendedMove[] {
  const moves: ProductTotalityRecommendedMove[] = [];
  for (const capability of capabilities) {
    for (const depth of capability.missing_depth.filter((entry) => entry.startsWith('v1:') || entry.startsWith('v2:'))) {
      const level = depth.slice(0, 2);
      moves.push({
        id: `${capability.id}-${level}`,
        title: `Deepen ${capability.title} to ${depth}`,
        lane: 'product',
        type: 'core-product-slice',
        why: 'Completed cycle seeded this capability, but the maturity ladder is not represented as living work.',
        evidence: capability.evidence,
      });
    }
    if (capabilityGraph.orphan_capabilities.some((orphan) => orphan.capability_id === capability.id)) {
      moves.push({
        id: `${capability.id}-connect`,
        title: `Connect ${capability.title} to adjacent product systems`,
        lane: 'ux',
        type: 'core-product-slice',
        why: 'A useful capability becomes more meaningful when it participates in return-session, ecosystem, and visual/meaning systems.',
        evidence: capability.evidence,
      });
    }
  }

  if (gaps.some((gap) => gap.code === 'infrastructure-outruns-product-body')) {
    moves.push({
      id: 'rebalance-user-visible-depth',
      title: 'Rebalance next cycle toward user-visible capability depth',
      lane: 'product',
      type: 'core-product-slice',
      why: 'Supporting systems are useful only when they increase the product body a user can act through.',
      evidence: [PORTFOLIO_LEDGER_RELATIVE_PATH],
    });
  }

  return dedupeMoves(moves).slice(0, 12);
}

function buildScores(input: {
  capabilities: ProductTotalityCapability[];
  capabilityGraph: ProductCapabilityGraphSnapshot;
  supportingSystems: number;
  lanes: string[];
  portfolioItems: number;
  activeOrSelectedItems: number;
}): ProductTotalityReport['scores'] {
  const capabilityCount = input.capabilities.length;
  const compositionValue = capabilityCount === 0
    ? 0
    : clamp((capabilityCount + input.supportingSystems * 0.5) / 4);
  const connectednessValue = capabilityCount === 0
    ? 0
    : clamp(
        average(input.capabilities.map((capability) => clamp(capability.connections.length / 4))) * 0.7
        + graphConnectednessScore(input.capabilityGraph) * 0.3
        - orphanPenalty(input.capabilityGraph),
      );
  const freedomValue = clamp((input.lanes.length + Math.min(input.portfolioItems, 40) / 10 + input.activeOrSelectedItems / 8) / 8);
  const depthValue = capabilityCount === 0
    ? 0
    : average(input.capabilities.map((capability) => {
        if (capability.maturity === 'systemic-v2') return 1;
        if (capability.maturity === 'contextual-v1') return 0.7;
        if (capability.maturity === 'seeded-v0') return 0.35;
        return 0.1;
      }));
  const infraPenalty = input.supportingSystems > capabilityCount + 2 ? 0.15 : 0;
  const complexityFitValue = clamp(
    compositionValue * 0.3
    + connectednessValue * 0.3
    + freedomValue * 0.15
    + depthValue * 0.25
    - infraPenalty,
  );

  return {
    composition: score(compositionValue, 'how much product body exists beyond isolated controls'),
    connectedness: score(connectednessValue, 'how strongly completed capabilities connect to learning, roadmap, ecosystem, meaning, and visual evidence'),
    freedom: score(freedomValue, 'how many lanes and future moves the product can express without collapsing into one rigid path'),
    depth: score(depthValue, 'how far completed capabilities have moved from v0 seeds toward v1/v2 maturity'),
    complexity_fit: score(complexityFitValue, 'whether the current degree of complexity is meaningful rather than too simple or support-heavy'),
    beauty_fit: score(complexityFitValue, 'beauty proxy: the chosen degree of complexity, connectedness, freedom, and depth'),
  };
}

function determineStatus(
  capabilities: ProductTotalityCapability[],
  gaps: ProductTotalityGap[],
  scores: ProductTotalityReport['scores'],
): ProductTotalityStatus {
  if (capabilities.length === 0) return 'empty';
  if (gaps.some((gap) => gap.code === 'orphan-capability')) return 'under-connected';
  if (scores.composition.value < 0.35) return 'under-composed';
  if (scores.connectedness.value < 0.45) return 'under-connected';
  if (gaps.some((gap) => gap.code === 'seeded-capability-needs-depth') || scores.depth.value < 0.55) return 'needs-depth';
  return 'balanced';
}

function nextAction(status: ProductTotalityStatus, gaps: ProductTotalityGap[]): string {
  if (status === 'empty') return 'Complete one product-cycle, capture learning, then rerun omc product-totality audit --write';
  if (gaps.some((gap) => gap.severity === 'error')) return 'Repair totality audit errors, then run omc product-totality audit --write again';
  return 'Feed .omc/product/totality/current.json into /priority-engine before selecting the next cycle';
}

function countSupportingSystems(cycles: RawCycleDocument[], portfolio: PortfolioLedger | undefined): number {
  const cycleSystems = cycles.filter((entry) => entry.document.cycle_stage === 'complete').reduce((sum, entry) => {
    const route = entry.document.spec.build_route;
    if (route === 'backend-pipeline') return sum + 1;
    if (route === 'both') return sum + 1;
    return sum + (entry.document.selected_portfolio.enabling_task ? 0.5 : 0);
  }, 0);
  const portfolioSystems = (portfolio?.items ?? []).filter((item) => (
    item.status !== 'rejected'
    && (item.lane === 'backend' || item.lane === 'quality' || item.type === 'enabling')
  )).length;
  return Math.round(cycleSystems + portfolioSystems);
}

function findPortfolioMatches(title: string, portfolio: PortfolioLedger | undefined): PortfolioWorkItem[] {
  return (portfolio?.items ?? []).filter((item) => mentions(`${item.id} ${item.title}`, title));
}

function mentions(haystack: string, needle: string): boolean {
  const tokens = keywords(needle);
  if (tokens.length === 0) return false;
  const lower = haystack.toLowerCase();
  return tokens.slice(0, 6).some((token) => lower.includes(token));
}

function containsDepthPhrase(haystack: string, phrase: string): boolean {
  const normalizedHaystack = normalizePhrase(haystack);
  const normalizedPhrase = normalizePhrase(phrase);
  if (!normalizedPhrase) return false;
  if (normalizedHaystack.includes(normalizedPhrase)) return true;
  const tokens = keywords(phrase);
  return tokens.length >= 3 && tokens.every((token) => normalizedHaystack.includes(token));
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywords(value: string): string[] {
  return Array.from(new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token))))
    .slice(0, 10);
}

function score(value: number, detail: string): ProductTotalityScore {
  const rounded = Math.round(clamp(value) * 100) / 100;
  const status = rounded >= 0.7 ? 'good' : rounded >= 0.4 ? 'warn' : 'bad';
  return { value: rounded, status, detail };
}

function graphConnectednessScore(graph: ProductCapabilityGraphSnapshot): number {
  if (graph.aggregates.capability_count === 0) return 0;
  if (graph.aggregates.capability_count === 1) {
    return clamp(graph.aggregates.edge_count / 4);
  }
  const possibleUsefulDegree = Math.min(4, graph.aggregates.capability_count + 2);
  return clamp(graph.aggregates.average_capability_degree / possibleUsefulDegree);
}

function orphanPenalty(graph: ProductCapabilityGraphSnapshot): number {
  if (graph.aggregates.capability_count === 0) return 0;
  return clamp(graph.aggregates.orphan_count / graph.aggregates.capability_count) * 0.2;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function dedupeMoves(moves: ProductTotalityRecommendedMove[]): ProductTotalityRecommendedMove[] {
  const seen = new Set<string>();
  const out: ProductTotalityRecommendedMove[] = [];
  for (const move of moves) {
    if (seen.has(move.id)) continue;
    seen.add(move.id);
    out.push(move);
  }
  return out;
}

function parseJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function safeList(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function normalizeRelative(root: string, path: string): string {
  const rel = relative(root, path).replace(/\\/g, '/');
  if (rel === CYCLE_DOCUMENT_RELATIVE_PATH || rel === CYCLE_PROJECTION_RELATIVE_PATH) return rel;
  if (rel === LEARNING_DOCUMENT_RELATIVE_PATH || rel === LEARNING_PROJECTION_RELATIVE_PATH) return rel;
  return rel;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'capability';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

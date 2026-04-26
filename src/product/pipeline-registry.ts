export const PRODUCT_PIPELINE_CONTRACT_STAGES = [
  'discovery-handoff',
  'priority-handoff',
  'foundation-lite',
  'technology-handoff',
  'cycle',
  'all',
] as const;

export type ProductPipelineContractStage = typeof PRODUCT_PIPELINE_CONTRACT_STAGES[number];

export const PRODUCT_STANDARD_FOOTER_FIELDS = [
  'status:',
  'evidence:',
  'confidence:',
  'blocking_issues:',
  'next_action:',
  'artifacts_written:',
] as const;

export type ProductArtifactFormat = 'markdown' | 'json' | 'jsonc';

export interface ProductArtifactRegistryEntry {
  name: string;
  lane: string;
  currentPath: string;
  format: ProductArtifactFormat;
  owner: string;
  machineContract: 'strict' | 'footer' | 'advisory';
  datedPattern?: string;
  purpose: string;
}

export const PRODUCT_ARTIFACT_REGISTRY = {
  ideas: {
    name: 'ideas',
    lane: 'discovery',
    currentPath: '.omc/ideas/current.md',
    format: 'markdown',
    owner: 'ideate',
    machineContract: 'footer',
    datedPattern: '.omc/ideas/YYYY-MM-DD-<slug>.md',
    purpose: 'Current product hypotheses and idea shortlist.',
  },
  specs: {
    name: 'specs',
    lane: 'discovery',
    currentPath: '.omc/specs/current.md',
    format: 'markdown',
    owner: 'deep-interview',
    machineContract: 'footer',
    datedPattern: '.omc/specs/YYYY-MM-DD-<slug>.md',
    purpose: 'Problem framing, requirements, and ambiguity-reduction output.',
  },
  competitors: {
    name: 'competitors',
    lane: 'research',
    currentPath: '.omc/competitors/landscape/current.md',
    format: 'markdown',
    owner: 'competitor-scout',
    machineContract: 'footer',
    datedPattern: '.omc/competitors/landscape/YYYY-MM-DD-<slug>.md',
    purpose: 'Competitive landscape and action-oriented whitespace evidence.',
  },
  constitution: {
    name: 'constitution',
    lane: 'meaning',
    currentPath: '.omc/constitution.md',
    format: 'markdown',
    owner: 'brand-steward',
    machineContract: 'footer',
    purpose: 'Brand/product principles and anti-goals.',
  },
  meaning: {
    name: 'meaning',
    lane: 'meaning',
    currentPath: '.omc/meaning/current.md',
    format: 'markdown',
    owner: 'brand-architect',
    machineContract: 'footer',
    datedPattern: '.omc/meaning/YYYY-MM-DD-<slug>.md',
    purpose: 'Compact meaning graph, hooks, category codes, and content angles.',
  },
  'capability-map': {
    name: 'capability-map',
    lane: 'product',
    currentPath: '.omc/product/capability-map/current.md',
    format: 'markdown',
    owner: 'product-strategist',
    machineContract: 'footer',
    datedPattern: '.omc/product/capability-map/YYYY-MM-DD-<slug>.md',
    purpose: 'Launch capability map, first usable loop, product-system gaps.',
  },
  ecosystem: {
    name: 'ecosystem',
    lane: 'product',
    currentPath: '.omc/ecosystem/current.md',
    format: 'markdown',
    owner: 'product-ecosystem-architect',
    machineContract: 'footer',
    datedPattern: '.omc/ecosystem/YYYY-MM-DD-<slug>.md',
    purpose: 'Long-horizon app/content/data/distribution loops and depth paths.',
  },
  'portfolio-ledger': {
    name: 'portfolio-ledger',
    lane: 'portfolio',
    currentPath: '.omc/portfolio/current.json',
    format: 'json',
    owner: 'priority-engine',
    machineContract: 'strict',
    purpose: 'Machine-readable product work-item ledger.',
  },
  'portfolio-projection': {
    name: 'portfolio-projection',
    lane: 'portfolio',
    currentPath: '.omc/portfolio/current.md',
    format: 'markdown',
    owner: 'omc portfolio project',
    machineContract: 'advisory',
    purpose: 'Human-readable projection generated from portfolio ledger.',
  },
  opportunities: {
    name: 'opportunities',
    lane: 'portfolio',
    currentPath: '.omc/opportunities/current.md',
    format: 'markdown',
    owner: 'priority-engine',
    machineContract: 'footer',
    datedPattern: '.omc/opportunities/YYYY-MM-DD-<slug>.md',
    purpose: 'Ranked candidate moves with evidence and selected cycle explanation.',
  },
  roadmap: {
    name: 'roadmap',
    lane: 'portfolio',
    currentPath: '.omc/roadmap/current.md',
    format: 'markdown',
    owner: 'priority-engine',
    machineContract: 'footer',
    datedPattern: '.omc/roadmap/YYYY-MM-DD-<slug>.md',
    purpose: 'Rolling 2/6/12-week roadmap and learning gates.',
  },
  'experience-gate': {
    name: 'experience-gate',
    lane: 'experience',
    currentPath: '.omc/experience/current.md',
    format: 'markdown',
    owner: 'product-experience-gate',
    machineContract: 'footer',
    datedPattern: '.omc/experience/YYYY-MM-DD-<slug>.md',
    purpose: 'Pre-build UX gate for journey, empty/failure states, return session, perceived value.',
  },
  cycle: {
    name: 'cycle',
    lane: 'cycle',
    currentPath: '.omc/cycles/current.md',
    format: 'markdown',
    owner: 'product-cycle-controller',
    machineContract: 'footer',
    datedPattern: '.omc/cycles/YYYY-MM-DD-<slug>.md',
    purpose: 'Active product learning loop state (markdown projection of cycle-document).',
  },
  'cycle-document': {
    name: 'cycle-document',
    lane: 'cycle',
    currentPath: '.omc/cycles/current.json',
    format: 'json',
    owner: 'product-cycle-controller',
    machineContract: 'strict',
    purpose: 'Typed JSON source of truth for the active product cycle (use omc product-cycle migrate-document).',
  },
  learning: {
    name: 'learning',
    lane: 'cycle',
    currentPath: '.omc/learning/current.md',
    format: 'markdown',
    owner: 'product-cycle-controller',
    machineContract: 'footer',
    datedPattern: '.omc/learning/YYYY-MM-DD-<slug>.md',
    purpose: 'Learning capture after verify (markdown projection of learning-document).',
  },
  'learning-document': {
    name: 'learning-document',
    lane: 'cycle',
    currentPath: '.omc/learning/current.json',
    format: 'json',
    owner: 'product-cycle-controller',
    machineContract: 'strict',
    purpose: 'Typed JSON source of truth for the cycle learning capture (use omc learning migrate).',
  },
} as const satisfies Record<string, ProductArtifactRegistryEntry>;

export type ProductPipelineArtifactName = keyof typeof PRODUCT_ARTIFACT_REGISTRY;

export const PRODUCT_ARTIFACT_PATHS = Object.fromEntries(
  Object.entries(PRODUCT_ARTIFACT_REGISTRY).map(([name, entry]) => [name, entry.currentPath]),
) as Record<ProductPipelineArtifactName, string>;

export const PRODUCT_ARTIFACT_CURRENT_PATHS: ReadonlySet<string> = new Set(
  Object.values(PRODUCT_ARTIFACT_REGISTRY).map((entry) => entry.currentPath),
);

export const PRODUCT_ARTIFACT_ALLOWED_DIRECTORIES = [
  '.omc/ideas/',
  '.omc/specs/',
  '.omc/competitors/',
  '.omc/brand/',
  '.omc/meaning/',
  '.omc/product/',
  '.omc/ecosystem/',
  '.omc/portfolio/',
  '.omc/opportunities/',
  '.omc/roadmap/',
  '.omc/experience/',
  '.omc/cycles/',
  '.omc/learning/',
  '.omc/decisions/',
  '.omc/provisioned/',
  '.omc/handoffs/',
  '.omc/audits/',
  '.omc/research/',
  '.omc/classification/',
  '.omc/reset/',
] as const;

export function isProductPipelineContractStage(stage: string): stage is ProductPipelineContractStage {
  return PRODUCT_PIPELINE_CONTRACT_STAGES.includes(stage as ProductPipelineContractStage);
}

export function getProductArtifactRegistryEntries(): ProductArtifactRegistryEntry[] {
  return Object.values(PRODUCT_ARTIFACT_REGISTRY);
}

export function renderProductPipelineRegistryMarkdown(): string {
  const rows = getProductArtifactRegistryEntries().map((entry) => [
    entry.name,
    entry.lane,
    entry.currentPath,
    entry.owner,
    entry.machineContract,
    entry.purpose,
  ]);

  return [
    '# Product Pipeline Registry',
    '',
    'Generated from `src/product/pipeline-registry.ts`. Do not edit this file by hand.',
    '',
    '## Contract Stages',
    '',
    ...PRODUCT_PIPELINE_CONTRACT_STAGES.map((stage) => `- \`${stage}\``),
    '',
    '## Artifacts',
    '',
    '| Artifact | Lane | Current Path | Owner | Contract | Purpose |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
    '',
  ].join('\n');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

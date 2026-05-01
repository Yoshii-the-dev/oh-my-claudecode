export declare const PRODUCT_PIPELINE_CONTRACT_STAGES: readonly ["discovery-handoff", "priority-handoff", "foundation-lite", "technology-handoff", "cycle", "all"];
export type ProductPipelineContractStage = typeof PRODUCT_PIPELINE_CONTRACT_STAGES[number];
/**
 * @deprecated Legacy footer fields — validation now uses `.output.json` sidecar files
 * per `docs/schemas/agent-output.schema.json`. Retained for backward-compatible rendering only.
 */
export declare const PRODUCT_STANDARD_FOOTER_FIELDS: readonly ["status:", "evidence:", "confidence:", "blocking_issues:", "next_action:", "artifacts_written:"];
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
export declare const PRODUCT_ARTIFACT_REGISTRY: {
    readonly ideas: {
        readonly name: "ideas";
        readonly lane: "discovery";
        readonly currentPath: ".omc/ideas/current.md";
        readonly format: "markdown";
        readonly owner: "ideate";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/ideas/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Current product hypotheses and idea shortlist.";
    };
    readonly specs: {
        readonly name: "specs";
        readonly lane: "discovery";
        readonly currentPath: ".omc/specs/current.md";
        readonly format: "markdown";
        readonly owner: "deep-interview";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/specs/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Problem framing, requirements, and ambiguity-reduction output.";
    };
    readonly competitors: {
        readonly name: "competitors";
        readonly lane: "research";
        readonly currentPath: ".omc/competitors/landscape/current.md";
        readonly format: "markdown";
        readonly owner: "competitor-scout";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/competitors/landscape/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Competitive landscape and action-oriented whitespace evidence.";
    };
    readonly constitution: {
        readonly name: "constitution";
        readonly lane: "meaning";
        readonly currentPath: ".omc/constitution.md";
        readonly format: "markdown";
        readonly owner: "brand-steward";
        readonly machineContract: "footer";
        readonly purpose: "Brand/product principles and anti-goals.";
    };
    readonly meaning: {
        readonly name: "meaning";
        readonly lane: "meaning";
        readonly currentPath: ".omc/meaning/current.md";
        readonly format: "markdown";
        readonly owner: "brand-architect";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/meaning/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Compact meaning graph, hooks, category codes, and content angles.";
    };
    readonly 'capability-map': {
        readonly name: "capability-map";
        readonly lane: "product";
        readonly currentPath: ".omc/product/capability-map/current.md";
        readonly format: "markdown";
        readonly owner: "product-strategist";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/product/capability-map/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Launch capability map, first usable loop, product-system gaps.";
    };
    readonly 'product-totality': {
        readonly name: "product-totality";
        readonly lane: "product";
        readonly currentPath: ".omc/product/totality/current.json";
        readonly format: "json";
        readonly owner: "omc product-totality audit";
        readonly machineContract: "strict";
        readonly purpose: "Aggregate completed cycles, capability maturity, connectedness, complexity fit, and missing depth moves.";
    };
    readonly 'capability-graph': {
        readonly name: "capability-graph";
        readonly lane: "product";
        readonly currentPath: ".omc/product/capability-graph/current.json";
        readonly format: "json";
        readonly owner: "omc product-totality audit";
        readonly machineContract: "strict";
        readonly purpose: "Machine-readable graph of completed capabilities, context/artifact edges, missing maturity edges, and orphan capability detection.";
    };
    readonly 'scenario-coverage': {
        readonly name: "scenario-coverage";
        readonly lane: "product";
        readonly currentPath: ".omc/product/scenario-coverage/current.json";
        readonly format: "json";
        readonly owner: "omc scenario-coverage audit";
        readonly machineContract: "strict";
        readonly purpose: "Capability-to-user-scenario coverage audit linking completed work to runtime QA, simulator, or dogfood evidence.";
    };
    readonly 'scenario-generator': {
        readonly name: "scenario-generator";
        readonly lane: "product";
        readonly currentPath: ".omc/product/scenarios/current.json";
        readonly format: "json";
        readonly owner: "omc scenario-generator generate";
        readonly machineContract: "strict";
        readonly purpose: "Generated return-session user-loop scenario declarations derived from feature expectation contracts.";
    };
    readonly 'product-regression': {
        readonly name: "product-regression";
        readonly lane: "product";
        readonly currentPath: ".omc/product/regression/current.json";
        readonly format: "json";
        readonly owner: "omc product-regression audit";
        readonly machineContract: "strict";
        readonly purpose: "Cross-cycle regression and learning debt audit comparing completed cycles against totality and scenario evidence.";
    };
    readonly ecosystem: {
        readonly name: "ecosystem";
        readonly lane: "product";
        readonly currentPath: ".omc/ecosystem/current.md";
        readonly format: "markdown";
        readonly owner: "product-ecosystem-architect";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/ecosystem/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Long-horizon app/content/data/distribution loops and depth paths.";
    };
    readonly 'portfolio-ledger': {
        readonly name: "portfolio-ledger";
        readonly lane: "portfolio";
        readonly currentPath: ".omc/portfolio/current.json";
        readonly format: "json";
        readonly owner: "priority-engine";
        readonly machineContract: "strict";
        readonly purpose: "Machine-readable product work-item ledger.";
    };
    readonly 'portfolio-projection': {
        readonly name: "portfolio-projection";
        readonly lane: "portfolio";
        readonly currentPath: ".omc/portfolio/current.md";
        readonly format: "markdown";
        readonly owner: "omc portfolio project";
        readonly machineContract: "advisory";
        readonly purpose: "Human-readable projection generated from portfolio ledger.";
    };
    readonly opportunities: {
        readonly name: "opportunities";
        readonly lane: "portfolio";
        readonly currentPath: ".omc/opportunities/current.md";
        readonly format: "markdown";
        readonly owner: "priority-engine";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/opportunities/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Ranked candidate moves with evidence and selected cycle explanation.";
    };
    readonly roadmap: {
        readonly name: "roadmap";
        readonly lane: "portfolio";
        readonly currentPath: ".omc/roadmap/current.md";
        readonly format: "markdown";
        readonly owner: "priority-engine";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/roadmap/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Rolling 2/6/12-week roadmap and learning gates.";
    };
    readonly 'experience-gate': {
        readonly name: "experience-gate";
        readonly lane: "experience";
        readonly currentPath: ".omc/experience/current.md";
        readonly format: "markdown";
        readonly owner: "product-experience-gate";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/experience/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Pre-build UX gate for journey, empty/failure states, return session, perceived value.";
    };
    readonly 'creative-loop': {
        readonly name: "creative-loop";
        readonly lane: "design";
        readonly currentPath: ".omc/design/creative-loop/current.json";
        readonly format: "json";
        readonly owner: "creative-loop";
        readonly machineContract: "strict";
        readonly purpose: "UI/UX creative readiness gate: meaning, visual expectation, inspiration principles, divergent directions, motion, tokens, experiments, and taste verdict.";
    };
    readonly 'creative-visual-expectation': {
        readonly name: "creative-visual-expectation";
        readonly lane: "design";
        readonly currentPath: ".omc/design/visual-expectation/current.json";
        readonly format: "json";
        readonly owner: "creative-loop";
        readonly machineContract: "strict";
        readonly purpose: "Machine-readable contract for desired perception, category codes to avoid, selected direction, token rationale, component proofs, and screenshot evidence.";
    };
    readonly 'creative-taste-gate': {
        readonly name: "creative-taste-gate";
        readonly lane: "design";
        readonly currentPath: ".omc/design/taste-gate/current.md";
        readonly format: "markdown";
        readonly owner: "creative-loop";
        readonly machineContract: "footer";
        readonly purpose: "Human-readable taste verdict for distinctiveness, usability, accessibility, and brand fit before design-system promotion.";
    };
    readonly cycle: {
        readonly name: "cycle";
        readonly lane: "cycle";
        readonly currentPath: ".omc/cycles/current.md";
        readonly format: "markdown";
        readonly owner: "product-cycle-controller";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/cycles/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Active product learning loop state (markdown projection of cycle-document).";
    };
    readonly 'cycle-document': {
        readonly name: "cycle-document";
        readonly lane: "cycle";
        readonly currentPath: ".omc/cycles/current.json";
        readonly format: "json";
        readonly owner: "product-cycle-controller";
        readonly machineContract: "strict";
        readonly purpose: "Typed JSON source of truth for the active product cycle (use omc product-cycle migrate-document).";
    };
    readonly learning: {
        readonly name: "learning";
        readonly lane: "cycle";
        readonly currentPath: ".omc/learning/current.md";
        readonly format: "markdown";
        readonly owner: "product-cycle-controller";
        readonly machineContract: "footer";
        readonly datedPattern: ".omc/learning/YYYY-MM-DD-<slug>.md";
        readonly purpose: "Learning capture after verify (markdown projection of learning-document).";
    };
    readonly 'learning-document': {
        readonly name: "learning-document";
        readonly lane: "cycle";
        readonly currentPath: ".omc/learning/current.json";
        readonly format: "json";
        readonly owner: "product-cycle-controller";
        readonly machineContract: "strict";
        readonly purpose: "Typed JSON source of truth for the cycle learning capture (use omc learning migrate).";
    };
};
export type ProductPipelineArtifactName = keyof typeof PRODUCT_ARTIFACT_REGISTRY;
export declare const PRODUCT_ARTIFACT_PATHS: Record<ProductPipelineArtifactName, string>;
export declare const PRODUCT_ARTIFACT_CURRENT_PATHS: ReadonlySet<string>;
export declare const PRODUCT_ARTIFACT_ALLOWED_DIRECTORIES: readonly [".omc/ideas/", ".omc/specs/", ".omc/competitors/", ".omc/brand/", ".omc/meaning/", ".omc/product/", ".omc/ecosystem/", ".omc/portfolio/", ".omc/opportunities/", ".omc/roadmap/", ".omc/experience/", ".omc/design/", ".omc/cycles/", ".omc/learning/", ".omc/decisions/", ".omc/provisioned/", ".omc/handoffs/", ".omc/audits/", ".omc/research/", ".omc/classification/", ".omc/reset/"];
export declare function isProductPipelineContractStage(stage: string): stage is ProductPipelineContractStage;
export declare function getProductArtifactRegistryEntries(): ProductArtifactRegistryEntry[];
export declare function renderProductPipelineRegistryMarkdown(): string;
//# sourceMappingURL=pipeline-registry.d.ts.map
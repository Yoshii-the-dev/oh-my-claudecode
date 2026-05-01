import { type UnifiedMcpRegistryStatus } from '../installer/mcp-registry.js';
import type { PluginConfig } from '../shared/types.js';
export type FeatureGenerationStatus = 'ready' | 'needs-input' | 'needs-mcp' | 'blocked';
export type FeatureGenerationSourceKind = 'vision' | 'research' | 'competitors' | 'meaning' | 'ecosystem' | 'capability-map' | 'capability-graph' | 'scenario-generator' | 'scenario-coverage' | 'regression' | 'capability-lifecycle' | 'totality' | 'learning' | 'portfolio';
export interface FeatureGenerationSource {
    kind: FeatureGenerationSourceKind;
    path: string;
    status: 'present' | 'missing' | 'stale' | 'thin';
    ageDays?: number;
    chars?: number;
    reason: string;
}
export interface FeatureGenerationMcpRecommendation {
    server: 'linkup' | 'ref' | 'github' | 'company-context';
    configured: boolean;
    required: boolean;
    purpose: string;
    setup: string;
}
export interface FeatureGenerationPlan {
    schema_version: 1;
    produced_at: string;
    status: FeatureGenerationStatus;
    goal?: string;
    source_score: number;
    source_count: number;
    required_source_count: number;
    sources: FeatureGenerationSource[];
    mcp: FeatureGenerationMcpRecommendation[];
    recommended_commands: string[];
    blockers: string[];
    next_action: string;
}
export interface FeatureGenerationOptions {
    root?: string;
    goal?: string;
    now?: Date;
    staleAfterDays?: number;
    mcpStatus?: UnifiedMcpRegistryStatus;
    config?: PluginConfig;
}
export declare const FEATURE_GENERATION_JSON_RELATIVE_PATH = ".omc/feature-generation/current.json";
export declare const FEATURE_GENERATION_MD_RELATIVE_PATH = ".omc/feature-generation/current.md";
export declare function planFeatureGeneration(options?: FeatureGenerationOptions): FeatureGenerationPlan;
export declare function writeFeatureGenerationPlan(root: string | undefined, plan: FeatureGenerationPlan): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderFeatureGenerationPlan(plan: FeatureGenerationPlan): string;
//# sourceMappingURL=feature-generation.d.ts.map
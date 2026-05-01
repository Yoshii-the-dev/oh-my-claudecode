export type CreativeLoopStatus = 'ready' | 'needs-brief' | 'needs-divergence' | 'needs-experiments' | 'needs-taste-gate';
export type CreativeLoopArtifactId = 'meaning-brief' | 'inspiration-ledger' | 'visual-expectation' | 'design-directions' | 'motion-grammar' | 'token-system' | 'component-experiments' | 'taste-gate' | 'design-system';
export interface CreativeLoopArtifact {
    id: CreativeLoopArtifactId;
    path: string;
    required: boolean;
    exists: boolean;
    passed: boolean;
    reason: string;
}
export interface CreativeLoopPlan {
    schema_version: 1;
    produced_at: string;
    status: CreativeLoopStatus;
    goal?: string;
    artifacts: CreativeLoopArtifact[];
    missing_required: CreativeLoopArtifactId[];
    next_action: string;
    recommended_commands: string[];
}
export interface CreativeLoopOptions {
    root?: string;
    goal?: string;
    now?: Date;
}
export declare const CREATIVE_LOOP_JSON_RELATIVE_PATH = ".omc/design/creative-loop/current.json";
export declare const CREATIVE_LOOP_MD_RELATIVE_PATH = ".omc/design/creative-loop/current.md";
export declare const VISUAL_EXPECTATION_RELATIVE_PATH = ".omc/design/visual-expectation/current.json";
export declare const VISUAL_LIFECYCLE_JSON_RELATIVE_PATH = ".omc/design/visual-lifecycle/current.json";
export declare const VISUAL_LIFECYCLE_MD_RELATIVE_PATH = ".omc/design/visual-lifecycle/current.md";
export type VisualLifecycleStatus = 'empty' | 'needs-hypothesis' | 'needs-implementation-map' | 'needs-screenshot-proof' | 'needs-iteration' | 'healthy';
export type VisualLifecyclePhaseId = 'visual-hypothesis' | 'implementation-mapping' | 'screenshot-proof' | 'iteration-debt';
export type VisualLifecyclePhaseState = 'missing' | 'partial' | 'ready' | 'blocking' | 'watchlist';
export interface VisualLifecyclePhase {
    id: VisualLifecyclePhaseId;
    state: VisualLifecyclePhaseState;
    evidence: string[];
    gaps: string[];
    recommended_action: string;
}
export interface VisualLifecycleDebt {
    severity: 'warning' | 'error';
    phase: VisualLifecyclePhaseId;
    subject: string;
    message: string;
    recommended_action: string;
    evidence: string[];
}
export interface VisualLifecycleReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: VisualLifecycleStatus;
    goal?: string;
    source_artifacts: string[];
    aggregates: {
        phase_count: number;
        ready_phases: number;
        screenshot_proofs: number;
        iteration_debts: number;
        blocking_debts: number;
    };
    phases: VisualLifecyclePhase[];
    debts: VisualLifecycleDebt[];
    next_action: string;
}
export declare function planCreativeLoop(options?: CreativeLoopOptions): CreativeLoopPlan;
export declare function initCreativeLoop(options?: CreativeLoopOptions): CreativeLoopPlan;
export declare function writeCreativeLoopPlan(root: string | undefined, plan: CreativeLoopPlan): {
    jsonPath: string;
    mdPath: string;
};
export declare function generateVisualLifecycleReport(options?: CreativeLoopOptions): VisualLifecycleReport;
export declare function writeVisualLifecycleReport(root?: string, report?: VisualLifecycleReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderVisualLifecycleReport(report: VisualLifecycleReport): string;
export declare function renderCreativeLoopPlan(plan: CreativeLoopPlan): string;
export declare function shouldRunCreativeLoop(root?: string): boolean;
//# sourceMappingURL=creative-loop.d.ts.map
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
export declare function planCreativeLoop(options?: CreativeLoopOptions): CreativeLoopPlan;
export declare function initCreativeLoop(options?: CreativeLoopOptions): CreativeLoopPlan;
export declare function writeCreativeLoopPlan(root: string | undefined, plan: CreativeLoopPlan): {
    jsonPath: string;
    mdPath: string;
};
export declare function renderCreativeLoopPlan(plan: CreativeLoopPlan): string;
export declare function shouldRunCreativeLoop(root?: string): boolean;
//# sourceMappingURL=creative-loop.d.ts.map
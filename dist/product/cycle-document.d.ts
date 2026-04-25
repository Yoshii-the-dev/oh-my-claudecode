export type CycleStage = 'discover' | 'rank' | 'select' | 'spec' | 'build' | 'verify' | 'learn' | 'complete' | 'blocked';
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
export declare const CYCLE_DOCUMENT_RELATIVE_PATH = ".omc/cycles/current.json";
export declare const CYCLE_PROJECTION_RELATIVE_PATH = ".omc/cycles/current.md";
export declare function getCycleDocumentPath(root?: string): string;
export declare function getCycleProjectionPath(root?: string): string;
export declare function readCycleDocument(root?: string): CycleDocument | undefined;
export declare function validateCycleDocument(root?: string): CycleDocumentValidationReport;
export declare function writeCycleDocument(root: string, doc: CycleDocument): {
    jsonPath: string;
    projectionPath: string;
};
export declare function writeCycleProjection(root: string, document?: CycleDocument): string;
export declare function renderCycleProjection(doc: CycleDocument): string;
export declare function migrateCycleMarkdownToJson(root?: string, options?: CycleMigrationOptions): CycleMigrationReport;
export declare function parseCycleMarkdown(content: string, now?: string): CycleDocument;
//# sourceMappingURL=cycle-document.d.ts.map
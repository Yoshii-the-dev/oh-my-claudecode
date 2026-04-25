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
export declare const LEARNING_DOCUMENT_RELATIVE_PATH = ".omc/learning/current.json";
export declare const LEARNING_PROJECTION_RELATIVE_PATH = ".omc/learning/current.md";
export declare function getLearningDocumentPath(root?: string): string;
export declare function getLearningProjectionPath(root?: string): string;
export declare function readLearningDocument(root?: string): LearningDocument | undefined;
export declare function validateLearningDocument(root?: string): LearningDocumentValidationReport;
export declare function writeLearningDocument(root: string, doc: LearningDocument): {
    jsonPath: string;
    projectionPath: string;
};
export declare function writeLearningProjection(root: string, document?: LearningDocument): string;
export declare function renderLearningProjection(doc: LearningDocument): string;
export declare function migrateLearningMarkdownToJson(root?: string, options?: LearningMigrationOptions): LearningMigrationReport;
export declare function parseLearningMarkdown(content: string, options?: LearningMigrationOptions): LearningDocument;
//# sourceMappingURL=learning-document.d.ts.map
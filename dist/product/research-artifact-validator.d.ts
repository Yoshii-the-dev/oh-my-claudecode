export type ProductResearchVerdict = 'pass' | 'blocked' | 'unknown';
export interface ProductResearchArtifactIssue {
    severity: 'error' | 'warning';
    code: string;
    message: string;
}
export interface ProductResearchArtifactValidationResult {
    ok: boolean;
    path: string;
    exists: boolean;
    verdict: ProductResearchVerdict;
    issues: ProductResearchArtifactIssue[];
    metrics: {
        sourceCount: number;
        requiredSectionCount: number;
        userFacingSectionCount: number;
    };
}
export interface ValidateProductResearchArtifactOptions {
    root?: string;
    artifactPath?: string;
    expectedCycleId?: string;
    expectedCycleStage?: string;
    expectedCycleGoal?: string;
    expectedRouteIds?: string[];
    userFacing?: boolean;
    dependencySensitive?: boolean;
    backendSensitive?: boolean;
}
export declare function validateProductResearchArtifact(options?: ValidateProductResearchArtifactOptions): ProductResearchArtifactValidationResult;
//# sourceMappingURL=research-artifact-validator.d.ts.map
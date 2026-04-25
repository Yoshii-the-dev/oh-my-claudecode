import { type ProductPipelineArtifactName, type ProductPipelineContractStage } from './pipeline-registry.js';
export type { ProductPipelineArtifactName, ProductPipelineContractStage, } from './pipeline-registry.js';
export type ProductPipelineIssueSeverity = 'error' | 'warning';
export interface ProductPipelineValidationIssue {
    severity: ProductPipelineIssueSeverity;
    artifact: ProductPipelineArtifactName;
    code: string;
    message: string;
}
export interface ProductPipelineArtifactResult {
    artifact: ProductPipelineArtifactName;
    path: string;
    exists: boolean;
    metrics: Record<string, number | string | boolean>;
    issues: ProductPipelineValidationIssue[];
}
export interface ProductPipelineValidationReport {
    ok: boolean;
    root: string;
    stage: ProductPipelineContractStage;
    artifacts: ProductPipelineArtifactResult[];
    issues: ProductPipelineValidationIssue[];
    summary: {
        errors: number;
        warnings: number;
    };
}
export interface ValidateProductPipelineContractsOptions {
    root?: string;
    stage?: ProductPipelineContractStage;
}
export declare function validateProductPipelineContracts(options?: ValidateProductPipelineContractsOptions): ProductPipelineValidationReport;
//# sourceMappingURL=pipeline-contract-validator.d.ts.map
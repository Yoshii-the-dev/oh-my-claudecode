export interface ProductArtifactInventoryIssue {
    severity: 'error' | 'warning';
    code: string;
    path: string;
    message: string;
}
export interface ProductArtifactInventoryReport {
    ok: boolean;
    root: string;
    artifactRoot: string;
    filesScanned: number;
    registeredCurrentArtifacts: number;
    issues: ProductArtifactInventoryIssue[];
    summary: {
        errors: number;
        warnings: number;
        registeredArtifacts: number;
        unregisteredCurrentArtifacts: number;
        markdownWithoutFooter: number;
        stalePressureDirectories: number;
    };
}
export declare function validateProductArtifactInventory(root?: string): ProductArtifactInventoryReport;
//# sourceMappingURL=artifact-inventory.d.ts.map
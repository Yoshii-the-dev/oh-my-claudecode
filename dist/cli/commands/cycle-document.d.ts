/**
 * `omc product-cycle migrate|project` — typed JSON document helpers.
 */
export interface CycleDocumentCommandOptions {
    json?: boolean;
    force?: boolean;
    write?: boolean;
}
export declare function cycleDocumentMigrateCommand(root: string | undefined, options: CycleDocumentCommandOptions, logger?: Console): Promise<number>;
export declare function cycleDocumentProjectCommand(root: string | undefined, options: CycleDocumentCommandOptions, logger?: Console): Promise<number>;
export declare function cycleDocumentValidateCommand(root: string | undefined, options: CycleDocumentCommandOptions, logger?: Console): Promise<number>;
//# sourceMappingURL=cycle-document.d.ts.map
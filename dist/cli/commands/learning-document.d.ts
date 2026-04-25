/**
 * `omc learning migrate|project|validate` — typed JSON document helpers.
 */
export interface LearningDocumentCommandOptions {
    json?: boolean;
    force?: boolean;
    write?: boolean;
    cycleId?: string;
}
export declare function learningMigrateCommand(root: string | undefined, options: LearningDocumentCommandOptions, logger?: Console): Promise<number>;
export declare function learningProjectCommand(root: string | undefined, options: LearningDocumentCommandOptions, logger?: Console): Promise<number>;
export declare function learningValidateCommand(root: string | undefined, options: LearningDocumentCommandOptions, logger?: Console): Promise<number>;
//# sourceMappingURL=learning-document.d.ts.map
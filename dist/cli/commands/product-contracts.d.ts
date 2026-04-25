/**
 * `omc doctor product-contracts` — validate product pipeline handoff artifacts.
 */
export interface ProductContractsCommandOptions {
    stage?: string;
    json?: boolean;
}
export declare function productContractsCommand(root: string | undefined, options: ProductContractsCommandOptions): Promise<number>;
//# sourceMappingURL=product-contracts.d.ts.map
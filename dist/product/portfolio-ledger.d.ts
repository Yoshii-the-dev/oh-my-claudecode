export type PortfolioLane = 'product' | 'ux' | 'research' | 'backend' | 'quality' | 'brand-content' | 'distribution';
export type PortfolioStatus = 'candidate' | 'selected' | 'in_progress' | 'done' | 'blocked' | 'deferred' | 'rejected';
export interface PortfolioWorkItem {
    id: string;
    title: string;
    lane: PortfolioLane;
    status: PortfolioStatus;
    confidence: number | 'HIGH' | 'MEDIUM' | 'LOW' | 'high' | 'medium' | 'low';
    dependencies: string[];
    selected_cycle: string | null;
    evidence: string[];
    type?: 'core-product-slice' | 'enabling' | 'learning' | 'research' | 'quality' | 'distribution';
    user_visible?: boolean;
    expected_learning?: string;
    dependency_unlock?: string;
    feature_expectation?: PortfolioFeatureExpectation;
}
export interface PortfolioFeatureExpectation {
    user_job: string;
    first_meaningful_use: string;
    useless_if: string[];
    maturity_ladder: {
        v0: string;
        v1: string;
        v2: string;
    };
    not_done_until: string[];
}
export interface PortfolioLedger {
    schema_version: 1;
    updated_at: string;
    source_artifacts: string[];
    items: PortfolioWorkItem[];
}
export interface PortfolioLedgerIssue {
    severity: 'error' | 'warning';
    code: string;
    path: string;
    message: string;
}
export interface PortfolioLedgerValidationReport {
    ok: boolean;
    path: string;
    ledger?: PortfolioLedger;
    issues: PortfolioLedgerIssue[];
    summary: {
        items: number;
        selected: number;
        lanes: number;
        errors: number;
        warnings: number;
    };
}
export declare const PORTFOLIO_LEDGER_RELATIVE_PATH = ".omc/portfolio/current.json";
export declare const PORTFOLIO_PROJECTION_RELATIVE_PATH = ".omc/portfolio/current.md";
export declare const OPPORTUNITIES_RELATIVE_PATH = ".omc/opportunities/current.md";
export interface PortfolioMigrationOptions {
    source?: string;
    write?: boolean;
    force?: boolean;
    now?: string;
}
export interface PortfolioMigrationReport {
    ok: boolean;
    sourcePath: string;
    outputPath: string;
    projectionPath?: string;
    wrote: boolean;
    ledger?: PortfolioLedger;
    issues: PortfolioLedgerIssue[];
}
export interface PortfolioTrimOptions {
    to?: number;
    write?: boolean;
    now?: string;
}
export interface PortfolioTrimReport {
    ok: boolean;
    path: string;
    projectionPath?: string;
    wrote: boolean;
    target: number;
    originalCount: number;
    trimmedCount: number;
    removedCount: number;
    removedItems: Array<Pick<PortfolioWorkItem, 'id' | 'title' | 'lane' | 'status'>>;
    ledger?: PortfolioLedger;
    issues: PortfolioLedgerIssue[];
}
export declare function getPortfolioLedgerPath(root?: string): string;
export declare function readPortfolioLedger(root?: string): PortfolioLedger | undefined;
export declare function validatePortfolioLedger(root?: string): PortfolioLedgerValidationReport;
export declare function renderPortfolioProjection(ledger: PortfolioLedger): string;
export declare function writePortfolioProjection(root?: string, path?: string): string;
export declare function migrateOpportunitiesToPortfolioLedger(root?: string, options?: PortfolioMigrationOptions): PortfolioMigrationReport;
export declare function trimPortfolioLedger(root?: string, options?: PortfolioTrimOptions): PortfolioTrimReport;
export declare function isFeatureExpectation(value: unknown): value is PortfolioFeatureExpectation;
//# sourceMappingURL=portfolio-ledger.d.ts.map
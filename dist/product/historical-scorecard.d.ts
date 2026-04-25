export interface HistoricalCycleSummary {
    cycle_id: string;
    source: 'json' | 'markdown';
    source_path: string;
    cycle_stage: string;
    product_stage: string;
    build_route: string;
    status: string;
    confidence: number | string;
    start_date?: string;
    completed_date?: string;
    time_to_complete_days: number | null;
    stages_completed: number;
    stages_total: number;
    user_visible_count: number;
    infrastructure_count: number;
    user_visible_ratio: number | null;
    evidence_count: number;
    has_learning_capture: boolean;
    learning_recommended_next_cycle?: string;
}
export interface HistoricalTrend {
    metric: string;
    values: Array<{
        cycleId: string;
        value: number | null;
    }>;
    direction: 'improving' | 'regressing' | 'flat' | 'unknown';
    delta: number | null;
}
export interface HistoricalComparison {
    latest?: HistoricalCycleSummary;
    previous?: HistoricalCycleSummary;
    improvements: string[];
    regressions: string[];
}
export interface HistoricalScorecardReport {
    root: string;
    artifactRoot: string;
    generatedAt: string;
    cycles: HistoricalCycleSummary[];
    trends: HistoricalTrend[];
    comparison: HistoricalComparison;
    totals: {
        cycles: number;
        completed: number;
        blocked: number;
    };
}
export declare function generateHistoricalScorecard(root?: string): HistoricalScorecardReport;
//# sourceMappingURL=historical-scorecard.d.ts.map
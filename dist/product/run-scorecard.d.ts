export interface RunScorecardMetric {
    value: number | null;
    unit: string;
    status: 'good' | 'warn' | 'bad' | 'unknown';
    detail: string;
}
export interface RunScorecardReport {
    root: string;
    artifactRoot: string;
    generatedAt: string;
    totals: {
        artifacts: number;
        words: number;
        handoffs: number;
        decisions: number;
    };
    metrics: {
        downstreamAcceptedWithoutReworkRate: RunScorecardMetric;
        reworkRate: RunScorecardMetric;
        artifactBloatRate: RunScorecardMetric;
        timeToFirstUsableLoopDays: RunScorecardMetric;
        userVisibleToInfrastructureRatio: RunScorecardMetric;
        evidenceConfidenceCoverage: RunScorecardMetric;
        researchInsteadOfInventionRate: RunScorecardMetric;
    };
    evidence: {
        acceptedHandoffs: string[];
        reworkSignals: string[];
        bloatedArtifacts: string[];
        firstUsableLoopSignals: string[];
        userVisibleWork: string[];
        infrastructureWork: string[];
        decisionsWithEvidenceConfidence: string[];
        decisionsMissingEvidenceConfidence: string[];
        researchRoutedTasks: string[];
        inventionRiskSignals: string[];
    };
}
export declare function generateRunScorecard(root?: string): RunScorecardReport;
//# sourceMappingURL=run-scorecard.d.ts.map
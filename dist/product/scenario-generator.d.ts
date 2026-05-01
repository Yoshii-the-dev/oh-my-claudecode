import { type CycleFeatureExpectationContract } from './cycle-document.js';
export declare const PRODUCT_SCENARIO_GENERATOR_JSON_RELATIVE_PATH = ".omc/product/scenarios/current.json";
export declare const PRODUCT_SCENARIO_GENERATOR_MD_RELATIVE_PATH = ".omc/product/scenarios/current.md";
export type ProductScenarioGenerationStatus = 'empty' | 'needs-expectation' | 'partial' | 'ready';
export type ProductGeneratedScenarioPhase = 'setup' | 'start' | 'core-action' | 'state-change' | 'exit' | 'return' | 'continue-with-context' | 'proof';
export interface ProductGeneratedScenarioStep {
    order: number;
    phase: ProductGeneratedScenarioPhase;
    action: string;
    expected_state: string;
}
export interface ProductGeneratedScenario {
    id: string;
    cycle_id: string;
    cycle_goal: string;
    source_path: string;
    capability_title: string;
    user_job: string;
    first_meaningful_use: string;
    loop: {
        setup: string;
        start: string;
        core_action: string;
        state_change: string;
        exit: string;
        return: string;
        continue_with_context: string;
        proof: string;
    };
    steps: ProductGeneratedScenarioStep[];
    useless_if: string[];
    maturity_ladder: CycleFeatureExpectationContract['maturity_ladder'];
    not_done_until: string[];
    runtime_qa_flow: {
        id: string;
        path: string;
        verifies: string[];
        spec: string;
    };
    dogfood_prompt: string;
    evidence_required: string[];
}
export interface ProductScenarioGenerationGap {
    severity: 'warning' | 'error';
    code: string;
    subject: string;
    message: string;
    recommended_action: string;
}
export interface ProductScenarioGenerationReport {
    schema_version: 1;
    generated_at: string;
    root: string;
    status: ProductScenarioGenerationStatus;
    source_artifacts: string[];
    aggregates: {
        cycle_count: number;
        scenario_count: number;
        missing_expectation_count: number;
        return_session_scenarios: number;
    };
    scenarios: ProductGeneratedScenario[];
    gaps: ProductScenarioGenerationGap[];
    next_action: string;
}
export declare function generateProductScenarioPlan(root?: string, now?: Date): ProductScenarioGenerationReport;
export declare function writeProductScenarioPlan(root?: string, report?: ProductScenarioGenerationReport): {
    jsonPath: string;
    mdPath: string;
};
export declare function readProductScenarioPlan(root?: string): ProductScenarioGenerationReport | undefined;
export declare function renderProductScenarioPlan(report: ProductScenarioGenerationReport): string;
//# sourceMappingURL=scenario-generator.d.ts.map
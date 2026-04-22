import type { TeamPipelinePhase, TeamPipelineState, TeamTransitionResult, TeamPipelineSubphase, TeamPipelineCriticVerdict } from './types.js';
export declare const TEAM_STRATEGY_SUBPHASE_ORDER: readonly TeamPipelineSubphase[];
export interface TeamRoutingDecision {
    next_agent: 'deep-interview' | 'technology-strategist' | 'document-specialist' | 'critic' | 'stack-provision' | 'human-decision-gate';
    target_subphase: TeamPipelineSubphase;
    action: 'advance' | 'stay' | 'rewind' | 'halt';
    reason: string;
}
/** Validates that a value is a non-negative finite integer */
export declare function isNonNegativeFiniteInteger(n: unknown): n is number;
export declare function transitionTeamPhase(state: TeamPipelineState, next: TeamPipelinePhase, reason?: string): TeamTransitionResult;
export declare function requestTeamCancel(state: TeamPipelineState, preserveForResume?: boolean): TeamPipelineState;
export declare function transitionTeamSubphase(state: TeamPipelineState, next: TeamPipelineSubphase, reason?: string): TeamTransitionResult;
export declare function advanceTeamSubphase(state: TeamPipelineState, reason?: string): TeamTransitionResult;
export declare function updateTeamStrategyMetrics(state: TeamPipelineState, patch: Partial<TeamPipelineState['strategy_metrics']>): TeamPipelineState;
export declare function evaluateTeamRoutingDecision(state: TeamPipelineState): TeamRoutingDecision;
export declare function applyTeamCriticVerdict(state: TeamPipelineState, verdict: TeamPipelineCriticVerdict): TeamTransitionResult;
//# sourceMappingURL=transitions.d.ts.map
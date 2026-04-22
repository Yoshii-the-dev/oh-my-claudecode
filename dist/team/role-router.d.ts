/**
 * Intent-based role routing for team task assignment.
 *
 * Inspects task text to infer lane intent (what kind of work is needed),
 * then maps that intent to the most appropriate worker role.
 */
export type LaneIntent = 'implementation' | 'verification' | 'review' | 'debug' | 'strategy' | 'research' | 'critique' | 'design' | 'docs' | 'build-fix' | 'cleanup' | 'unknown';
export interface RoleRouterResult {
    role: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}
/** Role-to-keyword mapping for keyword-count scoring fallback */
export declare const ROLE_KEYWORDS: Record<string, RegExp[]>;
/**
 * Infer the lane intent from free-form task text.
 * Returns 'unknown' when no clear signal is found.
 */
export declare function inferLaneIntent(text: string): LaneIntent;
/**
 * Route a task to the most appropriate role based on intent and domain.
 *
 * Priority:
 * 1. strategy → 'technology-strategist' (high)
 * 2. research → 'document-specialist' (high)
 * 3. critique → 'critic' (high)
 * 4. build-fix → 'build-fixer' (high)
 * 5. debug → 'debugger' (high)
 * 6. docs → 'writer' (high)
 * 7. design → 'designer' (high)
 * 8. cleanup → 'code-simplifier' (high)
 * 9. review + security domain → 'security-reviewer' (high), else 'quality-reviewer' (high)
 * 10. verification → 'test-engineer' (high)
 * 11. implementation + security domain → fallbackRole (stays put)
 * 12. Keyword-count scoring for ambiguous intents
 * 13. Unknown → fallbackRole (low)
 */
export declare function routeTaskToRole(taskSubject: string, taskDescription: string, fallbackRole: string): RoleRouterResult;
//# sourceMappingURL=role-router.d.ts.map
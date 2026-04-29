import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
export const PRODUCT_CYCLE_AUTO_STATE_RELATIVE_PATH = '.omc/state/product-cycle-state.json';
export function readProductCycleAutoState(root = process.cwd()) {
    const path = resolve(root, PRODUCT_CYCLE_AUTO_STATE_RELATIVE_PATH);
    if (!existsSync(path))
        return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
export function writeProductCycleAutoState(root, state) {
    const path = resolve(root, PRODUCT_CYCLE_AUTO_STATE_RELATIVE_PATH);
    ensureDirSync(dirname(path));
    atomicWriteJsonSync(path, state);
    return state;
}
export function startProductCycleAutoState(options) {
    const existing = readProductCycleAutoState(options.root);
    const now = new Date().toISOString();
    const state = {
        mode: 'product-cycle',
        active: true,
        auto_policy: options.autoPolicy,
        started_at: existing?.started_at ?? now,
        updated_at: now,
        session_id: options.sessionId ?? existing?.session_id,
        root: options.root,
        cycle_id: options.cycleId,
        cycle_goal: options.cycleGoal,
        cycle_stage: options.cycleStage,
        attempt_counts: existing?.attempt_counts ?? {},
    };
    return writeProductCycleAutoState(options.root, state);
}
export function updateProductCycleAutoState(root, patch) {
    const existing = readProductCycleAutoState(root);
    const now = new Date().toISOString();
    const state = {
        mode: 'product-cycle',
        active: patch.active ?? existing?.active ?? true,
        auto_policy: patch.auto_policy ?? existing?.auto_policy ?? 'safe',
        started_at: patch.started_at ?? existing?.started_at ?? now,
        updated_at: now,
        completed_at: patch.completed_at ?? existing?.completed_at,
        session_id: patch.session_id ?? existing?.session_id,
        root,
        cycle_id: patch.cycle_id ?? existing?.cycle_id,
        cycle_goal: patch.cycle_goal ?? existing?.cycle_goal,
        cycle_stage: patch.cycle_stage ?? existing?.cycle_stage,
        stopped_reason: patch.stopped_reason ?? existing?.stopped_reason,
        last_decision: patch.last_decision ?? existing?.last_decision,
        attempt_counts: patch.attempt_counts ?? existing?.attempt_counts ?? {},
    };
    return writeProductCycleAutoState(root, state);
}
export function incrementProductCycleAutoAttempt(root, key) {
    const existing = readProductCycleAutoState(root);
    const counts = { ...(existing?.attempt_counts ?? {}) };
    counts[key] = (counts[key] ?? 0) + 1;
    updateProductCycleAutoState(root, { attempt_counts: counts });
    return counts[key];
}
//# sourceMappingURL=cycle-auto-state.js.map
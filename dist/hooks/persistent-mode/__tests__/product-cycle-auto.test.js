import { mkdtempSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPersistentModes } from '../index.js';
import { writeProductCycleAutoState } from '../../../product/cycle-auto-state.js';
const roots = [];
afterEach(() => {
    for (const root of roots)
        rmSync(root, { recursive: true, force: true });
    roots.length = 0;
});
describe('persistent-mode product-cycle auto enforcement', () => {
    it('blocks stop while product-cycle --auto safe state is active', async () => {
        const root = createGitRoot();
        writeProductCycleAutoState(root, {
            mode: 'product-cycle',
            active: true,
            auto_policy: 'safe',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            root,
            cycle_stage: 'build',
            attempt_counts: {},
        });
        const result = await checkPersistentModes(undefined, root);
        expect(result.shouldBlock).toBe(true);
        expect(result.mode).toBe('product-cycle');
        expect(result.message).toContain('omc product-cycle run');
    });
    it('does not block inactive product-cycle state', async () => {
        const root = createGitRoot();
        writeProductCycleAutoState(root, {
            mode: 'product-cycle',
            active: false,
            auto_policy: 'safe',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            root,
            cycle_stage: 'build',
            attempt_counts: {},
        });
        const result = await checkPersistentModes(undefined, root);
        expect(result.shouldBlock).toBe(false);
    });
});
function createGitRoot() {
    const root = mkdtempSync(join(tmpdir(), 'omc-product-cycle-auto-hook-'));
    roots.push(root);
    execSync('git init', { cwd: root, stdio: 'ignore' });
    return root;
}
//# sourceMappingURL=product-cycle-auto.test.js.map
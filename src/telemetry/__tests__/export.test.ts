/**
 * export.test.ts
 *
 * Verifies the export.ts stub throws "not implemented".
 */

import { describe, it, expect } from 'vitest';
import { exportDigests } from '../export.js';

describe('telemetry/export stub', () => {
  it('throws "not implemented" with Phase 4 reference', async () => {
    await expect(
      exportDigests('local', { from: '2026-01-01', to: '2026-01-31' })
    ).rejects.toThrow('not implemented');
  });

  it('throws for cloud-opt-in target too', async () => {
    await expect(
      exportDigests('cloud-opt-in', { from: '2026-01-01', to: '2026-01-31' })
    ).rejects.toThrow('not implemented');
  });
});

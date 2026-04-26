import { describe, expect, it } from 'vitest';
import {
  PRODUCT_ARTIFACT_REGISTRY,
  PRODUCT_PIPELINE_CONTRACT_STAGES,
  renderProductPipelineRegistryMarkdown,
} from '../pipeline-registry.js';

describe('product pipeline registry', () => {
  it('is the canonical source for product contract stages and artifacts', () => {
    expect(PRODUCT_PIPELINE_CONTRACT_STAGES).toEqual([
      'discovery-handoff',
      'priority-handoff',
      'foundation-lite',
      'technology-handoff',
      'cycle',
      'all',
    ]);
    expect(PRODUCT_ARTIFACT_REGISTRY['portfolio-ledger'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['experience-gate'].currentPath).toBe('.omc/experience/current.md');
  });

  it('renders generated registry documentation', () => {
    const markdown = renderProductPipelineRegistryMarkdown();

    expect(markdown).toContain('Generated from `src/product/pipeline-registry.ts`');
    expect(markdown).toContain('| portfolio-ledger | portfolio | .omc/portfolio/current.json |');
    expect(markdown).toContain('| experience-gate | experience | .omc/experience/current.md |');
  });
});

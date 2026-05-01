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
    expect(PRODUCT_ARTIFACT_REGISTRY['creative-loop'].currentPath).toBe('.omc/design/creative-loop/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['creative-loop'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['creative-visual-expectation'].currentPath).toBe('.omc/design/visual-expectation/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['creative-visual-expectation'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['visual-lifecycle'].currentPath).toBe('.omc/design/visual-lifecycle/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['visual-lifecycle'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-lifecycle-history'].currentPath).toBe('.omc/product/capability-lifecycle/history.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-lifecycle-history'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['product-totality'].currentPath).toBe('.omc/product/totality/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['product-totality'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-graph'].currentPath).toBe('.omc/product/capability-graph/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-graph'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['scenario-coverage'].currentPath).toBe('.omc/product/scenario-coverage/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['scenario-coverage'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['scenario-generator'].currentPath).toBe('.omc/product/scenarios/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['scenario-generator'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['product-regression'].currentPath).toBe('.omc/product/regression/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['product-regression'].machineContract).toBe('strict');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-lifecycle'].currentPath).toBe('.omc/product/capability-lifecycle/current.json');
    expect(PRODUCT_ARTIFACT_REGISTRY['capability-lifecycle'].machineContract).toBe('strict');
  });

  it('renders generated registry documentation', () => {
    const markdown = renderProductPipelineRegistryMarkdown();

    expect(markdown).toContain('Generated from `src/product/pipeline-registry.ts`');
    expect(markdown).toContain('| portfolio-ledger | portfolio | .omc/portfolio/current.json |');
    expect(markdown).toContain('| experience-gate | experience | .omc/experience/current.md |');
    expect(markdown).toContain('| creative-loop | design | .omc/design/creative-loop/current.json |');
    expect(markdown).toContain('| creative-visual-expectation | design | .omc/design/visual-expectation/current.json |');
    expect(markdown).toContain('| visual-lifecycle | design | .omc/design/visual-lifecycle/current.json |');
    expect(markdown).toContain('| capability-lifecycle-history | product | .omc/product/capability-lifecycle/history.json |');
    expect(markdown).toContain('| product-totality | product | .omc/product/totality/current.json |');
    expect(markdown).toContain('| capability-graph | product | .omc/product/capability-graph/current.json |');
    expect(markdown).toContain('| scenario-coverage | product | .omc/product/scenario-coverage/current.json |');
    expect(markdown).toContain('| scenario-generator | product | .omc/product/scenarios/current.json |');
    expect(markdown).toContain('| product-regression | product | .omc/product/regression/current.json |');
    expect(markdown).toContain('| capability-lifecycle | product | .omc/product/capability-lifecycle/current.json |');
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { planFeatureGeneration, renderFeatureGenerationPlan, writeFeatureGenerationPlan } from '../feature-generation.js';
import type { UnifiedMcpRegistryStatus } from '../../installer/mcp-registry.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('feature generation readiness', () => {
  it('blocks when there is no goal or usable product source context', () => {
    const root = createRoot();

    const plan = planFeatureGeneration({
      root,
      now: new Date('2026-04-29T00:00:00.000Z'),
      mcpStatus: mcpStatus([]),
      config: { mcpServers: { linkup: { enabled: true }, ref: { enabled: true } } },
    });

    expect(plan.status).toBe('blocked');
    expect(plan.blockers.join('\n')).toContain('No goal');
    expect(plan.recommended_commands).toContain('/ideate "<cycle goal>"');
  });

  it('recommends missing MCP services for external discovery and docs-backed decisions', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/ideas/current.md', rich('vision'));
    writeArtifact(root, '.omc/product/capability-map/current.md', rich('capability map with api and simulator dependent decisions'));
    writeArtifact(root, '.omc/ecosystem/current.md', rich('ecosystem depth paths'));

    const plan = planFeatureGeneration({
      root,
      goal: 'ship activation loop',
      now: new Date('2026-04-29T00:00:00.000Z'),
      mcpStatus: mcpStatus([]),
      config: { mcpServers: { linkup: { enabled: true }, ref: { enabled: true } } },
    });

    expect(plan.status).toBe('needs-mcp');
    expect(plan.mcp.find((entry) => entry.server === 'linkup')).toMatchObject({ required: true, configured: false });
    expect(plan.mcp.find((entry) => entry.server === 'ref')).toMatchObject({ required: true, configured: false });
    expect(plan.recommended_commands[0]).toContain('/mcp-setup');
  });

  it('writes compact json and markdown handoff artifacts', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/ideas/current.md', rich('vision'));
    writeArtifact(root, '.omc/research/current.md', rich('research'));
    writeArtifact(root, '.omc/competitors/landscape/current.md', rich('competitor landscape'));
    writeArtifact(root, '.omc/meaning/current.md', rich('meaning'));
    writeArtifact(root, '.omc/product/capability-graph/current.json', JSON.stringify({
      nodes: [{ id: 'activation-loop', kind: 'capability', label: 'activation loop with enough graph context for source scoring' }],
      edges: [{ from: 'activation-loop', to: 'context:roadmap', type: 'context', label: 'roadmap', strength: 0.8 }],
      orphan_capabilities: [],
    }, null, 2));
    writeArtifact(root, '.omc/product/scenario-coverage/current.json', JSON.stringify({
      scenarios: [{ id: 'activation-loop-scenario', coverage: 'runtime-passed', expected_user_loop: 'finish activation loop' }],
      gaps: [],
      next_action: 'feed scenario evidence into priority engine',
    }, null, 2));
    writeArtifact(root, '.omc/product/regression/current.json', JSON.stringify({
      status: 'stable',
      debts: [],
      summary: 'Regression audit confirms completed capability evidence is current enough for feature generation source scoring and downstream cycle ranking.',
      next_action: 'continue priority engine with regression audit as a compact evidence source',
    }, null, 2));

    const plan = planFeatureGeneration({
      root,
      goal: 'rank next cycle',
      now: new Date('2026-04-29T00:00:00.000Z'),
      mcpStatus: mcpStatus(['linkup']),
      config: { mcpServers: { linkup: { enabled: true }, ref: { enabled: false } } },
    });
    const written = writeFeatureGenerationPlan(root, plan);

    expect(written.jsonPath).toContain('.omc/feature-generation/current.json');
    expect(written.mdPath).toContain('.omc/feature-generation/current.md');
    expect(plan.sources.find((source) => source.kind === 'capability-graph')?.status).toBe('present');
    expect(plan.sources.find((source) => source.kind === 'scenario-coverage')?.status).toBe('present');
    expect(plan.sources.find((source) => source.kind === 'regression')?.status).toBe('present');
    expect(renderFeatureGenerationPlan(plan)).toContain('Feature Generation Readiness');
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-feature-generation-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function rich(label: string): string {
  return `# ${label}\n\nThis artifact contains enough compact current context to support feature generation decisions, scoring, confidence calibration, and downstream product-cycle routing.`;
}

function mcpStatus(serverNames: string[]): UnifiedMcpRegistryStatus {
  return {
    registryPath: '/tmp/mcp-registry.json',
    claudeConfigPath: '/tmp/claude.json',
    codexConfigPath: '/tmp/config.toml',
    registryExists: serverNames.length > 0,
    serverNames,
    claudeMissing: [],
    claudeMismatched: [],
    codexMissing: [],
    codexMismatched: [],
  };
}

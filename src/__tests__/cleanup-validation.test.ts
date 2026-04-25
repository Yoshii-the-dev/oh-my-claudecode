import { describe, it, expect } from 'vitest';

describe('Cleanup Validation', () => {
  it('omc-plan skill resolves correctly', async () => {
    const { getBuiltinSkill } = await import('../features/builtin-skills/skills.js');
    const skill = getBuiltinSkill('omc-plan');
    expect(skill).toBeDefined();
  });

  it('plan skill is blocked by CC native denylist', async () => {
    const { getBuiltinSkill } = await import('../features/builtin-skills/skills.js');
    const skill = getBuiltinSkill('plan');
    expect(skill).toBeUndefined();
  });

  it('old keywords do not match active patterns', async () => {
    const { detectKeywordsWithType } = await import('../hooks/keyword-detector/index.js');
    const result = detectKeywordsWithType('ultrapilot build this');
    expect(result).toEqual([]);
  });

  it('deprecated keyword infrastructure is removed', async () => {
    const keywordModule = await import('../hooks/keyword-detector/index.js');
    expect('detectDeprecatedKeywords' in keywordModule).toBe(false);
    expect('DEPRECATED_KEYWORD_PATTERNS' in keywordModule).toBe(false);
  });

  it('PluginConfig.agents covers required core entries plus omc', async () => {
    const { DEFAULT_CONFIG } = await import('../config/loader.js');
    const agentKeys = Object.keys(DEFAULT_CONFIG.agents || {});
    expect(agentKeys).toContain('omc');
    expect(agentKeys).toContain('explore');
    expect(agentKeys).toContain('architect');
    expect(agentKeys).toContain('executor');
    expect(agentKeys).toContain('documentSpecialist');
    expect(agentKeys).toContain('technologyStrategist');
    expect(agentKeys).toContain('productCycleController');
    expect(agentKeys).toContain('priorityEngine');
    expect(agentKeys).toContain('productEcosystemArchitect');
    expect(agentKeys).toContain('critic');
    expect(agentKeys).toContain('tracer');
    // Stale entries should NOT be present
    expect(agentKeys).not.toContain('frontendEngineer');
    expect(agentKeys).not.toContain('documentWriter');
    expect(agentKeys).not.toContain('multimodalLooker');
    expect(agentKeys).not.toContain('coordinator');
    // Absorbed agents (consolidated in v4.8)
    expect(agentKeys).not.toContain('qualityReviewer');
    expect(agentKeys).not.toContain('deepExecutor');
    expect(agentKeys).not.toContain('buildFixer');
  });

  it('agent registry size matches filesystem prompts and includes required agents', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const agentsDir = path.join(here, '../../agents');
    const promptFiles = fs.readdirSync(agentsDir).filter((file) => file.endsWith('.md') && file !== 'AGENTS.md');

    const { getAgentDefinitions } = await import('../agents/definitions.js');
    const defs = getAgentDefinitions();
    expect(promptFiles.length).toBeGreaterThan(0);
    expect(Object.keys(defs).length).toBe(promptFiles.length);
    expect(defs).toHaveProperty('tracer');
    expect(defs).toHaveProperty('technology-strategist');
    expect(defs).toHaveProperty('brand-architect');
    expect(defs).toHaveProperty('campaign-composer');
    expect(defs).toHaveProperty('creative-director');
    expect(defs).toHaveProperty('domain-expert-reviewer');
    expect(defs).toHaveProperty('product-strategist');
    expect(defs).toHaveProperty('product-cycle-controller');
    expect(defs).toHaveProperty('priority-engine');
    expect(defs).toHaveProperty('product-ecosystem-architect');
  });
});

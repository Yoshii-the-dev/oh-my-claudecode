import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf-8');
}

function listSkillNames(): Set<string> {
  const skillsDir = join(ROOT, 'skills');
  return new Set(
    readdirSync(skillsDir)
      .filter((entry) => existsSync(join(skillsDir, entry, 'SKILL.md'))),
  );
}

function listAgentNames(): Set<string> {
  const agentsDir = join(ROOT, 'agents');
  return new Set(
    readdirSync(agentsDir)
      .filter((entry) => entry.endsWith('.md') && entry !== 'AGENTS.md')
      .map((entry) => entry.replace(/\.md$/, '')),
  );
}

describe('product/agent pipeline contracts', () => {
  it('resolves product-route oh-my-claudecode references to an installed skill or agent', () => {
    const routeFiles = [
      'skills/ideate/SKILL.md',
      'skills/creative-loop/SKILL.md',
      'skills/product-cycle/SKILL.md',
      'skills/product-totality/SKILL.md',
      'skills/capability-lifecycle/SKILL.md',
      'skills/scenario-generator/SKILL.md',
      'skills/scenario-coverage/SKILL.md',
      'skills/product-regression/SKILL.md',
      'skills/product-strategist/SKILL.md',
      'skills/product-foundation/SKILL.md',
      'skills/pre-launch-sprint/SKILL.md',
      'docs/PRODUCT-ORCHESTRATION.md',
      'docs/AGENT-PIPELINE-GOVERNANCE.md',
    ];
    const skills = listSkillNames();
    const agents = listAgentNames();

    for (const file of routeFiles) {
      const content = readRepoFile(file);
      const refs = [...content.matchAll(/oh-my-claudecode:([a-z0-9-]+)/g)].map((match) => match[1]);

      for (const ref of refs) {
        expect(
          skills.has(ref) || agents.has(ref),
          `${file} references oh-my-claudecode:${ref}, but no skill or agent exists`,
        ).toBe(true);
      }
    }
  });

  it('resolves product-route /prompts references to registered agent prompt files', () => {
    const files = [
      'skills/product-foundation/SKILL.md',
      'skills/product-cycle/SKILL.md',
      'docs/PRODUCT-ORCHESTRATION.md',
    ];
    const agents = listAgentNames();

    for (const file of files) {
      const refs = [...readRepoFile(file).matchAll(/\/prompts:([a-z0-9-]+)/g)].map((match) => match[1]);
      for (const ref of refs) {
        expect(agents.has(ref), `${file} references /prompts:${ref}, but no agent prompt exists`).toBe(true);
      }
    }
  });

  it('keeps pre-MVP foundation in foundation-lite before stack strategy', () => {
    const content = readRepoFile('skills/product-foundation/SKILL.md');

    expect(content).toContain('foundation-lite');
    expect(content).toContain('.omc/opportunities/current.md');
    expect(content).toContain('.omc/roadmap/current.md');
    expect(content).toContain('first usable loop');
    expect(content).toMatch(/1-2 ADRs/);
    expect(content.indexOf('-> priority-engine')).toBeGreaterThan(-1);
    expect(content.indexOf('-> priority-engine')).toBeLessThan(content.indexOf('-> technology-strategist'));
  });

  it('defines product-cycle as the controlling product learning loop', () => {
    const agent = readRepoFile('agents/product-cycle-controller.md');
    const skill = readRepoFile('skills/product-cycle/SKILL.md');
    const docs = readRepoFile('docs/PRODUCT-ORCHESTRATION.md');

    for (const content of [agent, skill, docs]) {
      expect(content).toContain('discover');
      expect(content).toContain('rank');
      expect(content).toContain('select');
      expect(content).toContain('spec');
      expect(content).toContain('build');
      expect(content).toContain('verify');
      expect(content).toContain('learn');
    }

    expect(agent).toContain('.omc/cycles/current.md');
    expect(agent).toContain('.omc/experience/current.md');
    expect(agent).toContain('.omc/learning/current.md');
    expect(agent).toContain('.omc/product/totality/current.json');
    expect(agent).toContain('.omc/product/capability-graph/current.json');
    expect(agent).toContain('.omc/product/scenarios/current.json');
    expect(agent).toContain('.omc/product/scenario-coverage/current.json');
    expect(agent).toContain('.omc/product/regression/current.json');
    expect(agent).toContain('.omc/product/capability-lifecycle/current.json');
    expect(agent).toContain('1 core product slice');
    expect(agent).toContain('1 enabling task');
    expect(agent).toContain('1 learning/research task');
    expect(skill).toContain('omc doctor product-contracts --stage cycle');
    expect(skill).toContain('/product-experience-gate');
    expect(skill).toContain('omc creative-loop audit');
    expect(skill).toContain('omc scenario-generator generate');
    expect(skill).toContain('omc capability-lifecycle audit');
    expect(skill).toContain('omc product-totality audit');
    expect(docs).toContain('/product-cycle "<cycle goal>"');
    expect(docs).toContain('/creative-loop "<core product slice>"');
    expect(docs).toContain('.omc/product/totality/current.json');
    expect(docs).toContain('.omc/product/capability-graph/current.json');
    expect(docs).toContain('.omc/product/scenarios/current.json');
    expect(docs).toContain('.omc/product/scenario-coverage/current.json');
    expect(docs).toContain('.omc/product/regression/current.json');
    expect(docs).toContain('.omc/product/capability-lifecycle/current.json');
  });

  it('defines product-totality as the aggregate post-cycle audit before the next priority pass', () => {
    const skill = readRepoFile('skills/product-totality/SKILL.md');
    const productCycle = readRepoFile('skills/product-cycle/SKILL.md');
    const priorityEngine = readRepoFile('skills/priority-engine/SKILL.md');
    const docs = readRepoFile('docs/PRODUCT-ORCHESTRATION.md');

    for (const content of [skill, productCycle, priorityEngine, docs]) {
      expect(content).toContain('.omc/product/totality/current.json');
      expect(content).toContain('.omc/product/capability-graph/current.json');
      expect(content).toContain('.omc/product/scenarios/current.json');
      expect(content).toContain('.omc/product/scenario-coverage/current.json');
      expect(content).toContain('.omc/product/regression/current.json');
      expect(content).toContain('.omc/product/capability-lifecycle/current.json');
      expect(content).toContain('product-totality audit');
    }

    expect(skill).toContain('composition');
    expect(skill).toContain('connectedness');
    expect(skill).toContain('freedom');
    expect(skill).toContain('depth');
    expect(priorityEngine).toContain('recommended_moves');
    expect(priorityEngine).toContain('orphan_capabilities');
    expect(priorityEngine).toContain('scenario coverage');
    expect(priorityEngine).toContain('regression debts');
    expect(priorityEngine).toContain('capability lifecycle');
    expect(docs).toContain('Product Totality Rules');
    expect(docs).toContain('Capability Graph Rules');
    expect(docs).toContain('Scenario Generator Rules');
    expect(docs).toContain('Scenario Coverage Rules');
    expect(docs).toContain('Product Regression Rules');
    expect(docs).toContain('Capability Lifecycle Rules');
  });

  it('defines creative-loop as a divergent UI/UX gate before visual implementation', () => {
    const skill = readRepoFile('skills/creative-loop/SKILL.md');
    const productPipeline = readRepoFile('skills/product-pipeline/SKILL.md');
    const docs = readRepoFile('docs/PRODUCT-ORCHESTRATION.md');

    expect(skill).toContain('Meaning brief');
    expect(skill).toContain('Inspiration ledger');
    expect(skill).toContain('Visual expectation contract');
    expect(skill).toContain('visual_expectation_contract');
    expect(skill).toContain('3-5 distinct design directions');
    expect(skill).toContain('Motion grammar');
    expect(skill).toContain('Token system');
    expect(skill).toContain('Component experiments');
    expect(skill).toContain('Taste gate');
    expect(skill).toContain('Do not copy references');
    expect(productPipeline).toContain('omc creative-loop audit');
    expect(productPipeline).toContain('.omc/design/visual-expectation/current.json');
    expect(docs).toContain('.omc/design/creative-loop/current.json');
    expect(docs).toContain('.omc/design/visual-expectation/current.json');
  });

  it('defines priority-engine as a broad portfolio layer, not a short feature shortlist', () => {
    const agent = readRepoFile('agents/priority-engine.md');
    const skill = readRepoFile('skills/priority-engine/SKILL.md');

    expect(agent).toContain('20-40 candidate moves');
    expect(agent).toContain('1 core product slice');
    expect(agent).toContain('1 enabling task');
    expect(agent).toContain('1 learning/research task');
    expect(agent).toContain('.omc/portfolio/current.json');
    expect(agent).toContain('.omc/opportunities/current.md');
    expect(agent).toContain('.omc/roadmap/current.md');
    expect(agent).toContain('.omc/product/totality/current.json');
    expect(agent).toContain('.omc/product/capability-graph/current.json');
    expect(agent).toContain('.omc/product/scenarios/current.json');
    expect(agent).toContain('.omc/product/scenario-coverage/current.json');
    expect(agent).toContain('.omc/product/regression/current.json');
    expect(agent).toContain('.omc/product/capability-lifecycle/current.json');
    expect(agent).toContain('priority-ignores-regression-debt');
    expect(skill).toContain('omc portfolio validate');
    expect(skill).toContain('omc product-totality audit');
    expect(skill).toContain('omc scenario-generator generate');
    expect(skill).toContain('omc capability-lifecycle audit');
    expect(skill).toContain('priority-ignores-regression-debt');
    expect(skill).toContain('product, UX, research, backend, quality, brand/content, and distribution');
  });

  it('does not default pre-MVP learning work to tester recruitment', () => {
    const agent = readRepoFile('agents/priority-engine.md');
    const skill = readRepoFile('skills/priority-engine/SKILL.md');

    expect(agent).toContain('External tester/design-partner recruitment is allowed only when the user explicitly requests it');
    expect(agent).toContain('simulator/runtime QA');
    expect(skill).toContain('do not default to tester recruitment');
    expect(skill).toContain('simulator/runtime smoke');
  });

  it('keeps the knitting replay fixture focused on product-surface debt before backend packages', () => {
    const agent = readRepoFile('agents/priority-engine.md');

    expect(agent).toContain('Knitting regression rule');
    expect(agent).toContain('product-surface debt');
    expect(agent).toContain('import/open sample pattern -> row track -> persist progress -> resume next session');
  });

  it('requires brand outputs to generate meaning hooks and marketing/content angles', () => {
    const brandArchitect = readRepoFile('agents/brand-architect.md');
    const brandSteward = readRepoFile('agents/brand-steward.md');

    expect(brandArchitect).toContain('.omc/meaning/current.md');
    expect(brandArchitect).toContain('marketing/content angles');
    expect(brandArchitect).toContain('must not become a long essay');
    expect(brandSteward).toContain('Meaning Hooks For Downstream Agents');
    expect(brandSteward).toContain('marketing/content angles');
  });
});

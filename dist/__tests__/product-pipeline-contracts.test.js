import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
const ROOT = process.cwd();
function readRepoFile(path) {
    return readFileSync(join(ROOT, path), 'utf-8');
}
function listSkillNames() {
    const skillsDir = join(ROOT, 'skills');
    return new Set(readdirSync(skillsDir)
        .filter((entry) => existsSync(join(skillsDir, entry, 'SKILL.md'))));
}
function listAgentNames() {
    const agentsDir = join(ROOT, 'agents');
    return new Set(readdirSync(agentsDir)
        .filter((entry) => entry.endsWith('.md') && entry !== 'AGENTS.md')
        .map((entry) => entry.replace(/\.md$/, '')));
}
describe('product/agent pipeline contracts', () => {
    it('resolves product-route oh-my-claudecode references to an installed skill or agent', () => {
        const routeFiles = [
            'skills/ideate/SKILL.md',
            'skills/product-cycle/SKILL.md',
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
                expect(skills.has(ref) || agents.has(ref), `${file} references oh-my-claudecode:${ref}, but no skill or agent exists`).toBe(true);
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
        expect(agent).toContain('1 core product slice');
        expect(agent).toContain('1 enabling task');
        expect(agent).toContain('1 learning/research task');
        expect(skill).toContain('omc doctor product-contracts --stage cycle');
        expect(skill).toContain('/product-experience-gate');
        expect(docs).toContain('/product-cycle "<cycle goal>"');
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
        expect(skill).toContain('omc portfolio validate');
        expect(skill).toContain('product, UX, research, backend, quality, brand/content, and distribution');
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
//# sourceMappingURL=product-pipeline-contracts.test.js.map
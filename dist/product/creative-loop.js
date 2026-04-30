import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync } from '../lib/atomic-write.js';
export const CREATIVE_LOOP_JSON_RELATIVE_PATH = '.omc/design/creative-loop/current.json';
export const CREATIVE_LOOP_MD_RELATIVE_PATH = '.omc/design/creative-loop/current.md';
export const VISUAL_EXPECTATION_RELATIVE_PATH = '.omc/design/visual-expectation/current.json';
const ARTIFACTS = [
    {
        id: 'meaning-brief',
        path: '.omc/design/meaning-brief/current.md',
        required: true,
        passTerms: ['feeling', 'understanding', 'user state', 'product meaning'],
    },
    {
        id: 'inspiration-ledger',
        path: '.omc/design/inspiration-ledger/current.md',
        required: true,
        passTerms: ['principle', 'what not to copy', 'source', 'constraint'],
    },
    {
        id: 'visual-expectation',
        path: VISUAL_EXPECTATION_RELATIVE_PATH,
        required: true,
        passTerms: [],
    },
    {
        id: 'design-directions',
        path: '.omc/design/directions/current.md',
        required: true,
        passTerms: ['direction 1', 'direction 2', 'direction 3', 'hypothesis', 'tradeoff'],
    },
    {
        id: 'motion-grammar',
        path: '.omc/design/motion-grammar/current.md',
        required: true,
        passTerms: ['state', 'why', 'duration', 'easing', 'reduced motion'],
    },
    {
        id: 'token-system',
        path: '.omc/design/tokens/current.json',
        required: true,
        passTerms: ['color', 'type', 'spacing', 'radius', 'elevation', 'motion'],
    },
    {
        id: 'component-experiments',
        path: '.omc/design/component-experiments/current.json',
        required: true,
        passTerms: ['screenshot', 'visual_verdict', 'experiment'],
    },
    {
        id: 'taste-gate',
        path: '.omc/design/taste-gate/current.md',
        required: true,
        passTerms: ['verdict: pass', 'distinctiveness', 'usability', 'accessibility', 'brand fit'],
    },
    {
        id: 'design-system',
        path: '.omc/design/system/current.md',
        required: false,
        passTerms: ['component', 'token', 'usage'],
    },
];
export function planCreativeLoop(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const artifacts = ARTIFACTS.map((artifact) => inspectArtifact(root, artifact));
    const missingRequired = artifacts
        .filter((artifact) => artifact.required && !artifact.passed)
        .map((artifact) => artifact.id);
    const status = creativeStatus(missingRequired);
    const commands = recommendedCommands(options.goal, status);
    return {
        schema_version: 1,
        produced_at: (options.now ?? new Date()).toISOString(),
        status,
        goal: options.goal,
        artifacts,
        missing_required: missingRequired,
        next_action: commands[0] ?? '/creative-loop "<visual goal>"',
        recommended_commands: commands,
    };
}
export function initCreativeLoop(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    for (const artifact of ARTIFACTS) {
        const path = resolve(root, artifact.path);
        if (existsSync(path))
            continue;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, templateFor(artifact.id, options.goal), 'utf-8');
    }
    const plan = planCreativeLoop(options);
    writeCreativeLoopPlan(root, plan);
    return plan;
}
export function writeCreativeLoopPlan(root = process.cwd(), plan) {
    const jsonPath = resolve(root, CREATIVE_LOOP_JSON_RELATIVE_PATH);
    const mdPath = resolve(root, CREATIVE_LOOP_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, plan);
    atomicWriteFileSync(mdPath, renderCreativeLoopPlan(plan));
    return { jsonPath, mdPath };
}
export function renderCreativeLoopPlan(plan) {
    return [
        '# Creative Loop Readiness',
        '',
        `status: ${plan.status}`,
        `produced_at: ${plan.produced_at}`,
        `goal: ${plan.goal ?? 'unknown'}`,
        '',
        '## Artifacts',
        '| Artifact | Required | Passed | Path | Reason |',
        '| --- | --- | --- | --- | --- |',
        ...plan.artifacts.map((artifact) => [
            artifact.id,
            String(artifact.required),
            String(artifact.passed),
            artifact.path,
            escapeCell(artifact.reason),
        ].join(' | ')).map((row) => `| ${row} |`),
        '',
        '## Missing Required',
        ...(plan.missing_required.length > 0 ? plan.missing_required.map((id) => `- ${id}`) : ['- none']),
        '',
        '## Recommended Commands',
        ...plan.recommended_commands.map((command) => `- \`${command}\``),
        '',
        `next_action: ${plan.next_action}`,
        '',
    ].join('\n');
}
export function shouldRunCreativeLoop(root = process.cwd()) {
    return planCreativeLoop({ root }).status !== 'ready';
}
function inspectArtifact(root, artifact) {
    const path = resolve(root, artifact.path);
    if (!existsSync(path)) {
        return {
            id: artifact.id,
            path: artifact.path,
            required: artifact.required,
            exists: false,
            passed: false,
            reason: 'missing',
        };
    }
    const rawContent = readFileSync(path, 'utf-8');
    const content = rawContent.toLowerCase();
    if (isDraftPlaceholder(content)) {
        return {
            id: artifact.id,
            path: artifact.path,
            required: artifact.required,
            exists: true,
            passed: false,
            reason: 'draft placeholder',
        };
    }
    if (artifact.id === 'visual-expectation') {
        const validation = validateVisualExpectationContract(root, rawContent);
        return {
            id: artifact.id,
            path: artifact.path,
            required: artifact.required,
            exists: true,
            passed: validation.passed,
            reason: validation.reason,
        };
    }
    if (artifact.id === 'token-system') {
        const validation = validateTokenSystem(rawContent);
        return {
            id: artifact.id,
            path: artifact.path,
            required: artifact.required,
            exists: true,
            passed: validation.passed,
            reason: validation.reason,
        };
    }
    if (artifact.id === 'component-experiments') {
        const validation = validateComponentExperiments(root, rawContent);
        return {
            id: artifact.id,
            path: artifact.path,
            required: artifact.required,
            exists: true,
            passed: validation.passed,
            reason: validation.reason,
        };
    }
    const missingTerms = artifact.passTerms.filter((term) => !content.includes(term));
    if (artifact.id === 'taste-gate' && missingTerms.length === 0 && !/\b(screenshot|visual_verdict|visual verdict|evidence)\b/i.test(rawContent)) {
        missingTerms.push('visual evidence');
    }
    return {
        id: artifact.id,
        path: artifact.path,
        required: artifact.required,
        exists: true,
        passed: missingTerms.length === 0,
        reason: missingTerms.length === 0 ? 'present and passes minimum contract' : `missing terms: ${missingTerms.join(', ')}`,
    };
}
function isDraftPlaceholder(content) {
    return /\bstatus:\s*draft\b/.test(content)
        || /"status"\s*:\s*"draft"/.test(content)
        || /<[^>\n]+>/.test(content);
}
function validateVisualExpectationContract(root, rawContent) {
    const parsed = parseJsonObject(rawContent);
    if (!parsed)
        return { passed: false, reason: 'invalid json' };
    const contract = objectValue(parsed.visual_expectation_contract) ?? parsed;
    const missing = [];
    requireMeaningfulList(contract, 'desired_perception', missing);
    requireMeaningfulList(contract, 'category_codes_to_avoid', missing);
    requireMeaningfulList(contract, 'not_ready_if', missing);
    requireStringFields(objectValue(contract.selected_direction), 'selected_direction', ['name', 'rationale', 'tradeoffs'], missing);
    const inspirationPrinciples = arrayValue(contract.inspiration_principles);
    if (!inspirationPrinciples || inspirationPrinciples.length === 0) {
        missing.push('inspiration_principles');
    }
    else {
        for (const [index, entry] of inspirationPrinciples.entries()) {
            requireStringFields(objectValue(entry), `inspiration_principles[${index}]`, ['source', 'principle', 'what_not_to_copy'], missing);
        }
    }
    const tokenRationale = arrayValue(contract.token_rationale);
    if (!tokenRationale || tokenRationale.length === 0) {
        missing.push('token_rationale');
    }
    else {
        for (const [index, entry] of tokenRationale.entries()) {
            requireStringFields(objectValue(entry), `token_rationale[${index}]`, ['token', 'decision', 'reason'], missing);
        }
    }
    const componentProofs = arrayValue(contract.component_proofs);
    if (!componentProofs || componentProofs.length === 0) {
        missing.push('component_proofs');
    }
    else {
        for (const [index, entry] of componentProofs.entries()) {
            const proof = objectValue(entry);
            requireStringFields(proof, `component_proofs[${index}]`, ['component', 'state', 'screenshot', 'visual_verdict'], missing);
            if (proof && hasMeaningfulString(proof.screenshot) && !pathExists(root, proof.screenshot)) {
                missing.push(`component_proofs[${index}].screenshot file`);
            }
            if (proof && hasMeaningfulString(proof.visual_verdict) && !/\bpass\b/i.test(proof.visual_verdict)) {
                missing.push(`component_proofs[${index}].visual_verdict pass`);
            }
        }
    }
    const screenshots = stringArrayValue(contract.screenshot_evidence);
    if (screenshots.length === 0) {
        missing.push('screenshot_evidence');
    }
    else {
        for (const [index, screenshot] of screenshots.entries()) {
            if (!pathExists(root, screenshot))
                missing.push(`screenshot_evidence[${index}] file`);
        }
    }
    return missing.length === 0
        ? { passed: true, reason: 'visual expectation contract passed' }
        : { passed: false, reason: `missing or invalid: ${missing.join(', ')}` };
}
function validateTokenSystem(rawContent) {
    const parsed = parseJsonObject(rawContent);
    if (!parsed)
        return { passed: false, reason: 'invalid json' };
    const required = ['color', 'type', 'spacing', 'radius', 'elevation', 'motion'];
    const missing = required.filter((field) => !hasNonEmptyStructuredValue(parsed[field]));
    return missing.length === 0
        ? { passed: true, reason: 'token system has meaningful required token groups' }
        : { passed: false, reason: `missing or empty token groups: ${missing.join(', ')}` };
}
function validateComponentExperiments(root, rawContent) {
    const parsed = parseJsonObject(rawContent);
    if (!parsed)
        return { passed: false, reason: 'invalid json' };
    const missing = [];
    const experiments = stringArrayValue(parsed.experiment);
    const screenshots = stringArrayValue(parsed.screenshot);
    const verdicts = stringArrayValue(parsed.visual_verdict);
    if (experiments.length === 0)
        missing.push('experiment');
    if (screenshots.length === 0) {
        missing.push('screenshot');
    }
    else {
        for (const [index, screenshot] of screenshots.entries()) {
            if (!pathExists(root, screenshot))
                missing.push(`screenshot[${index}] file`);
        }
    }
    if (verdicts.length === 0 || !verdicts.some((verdict) => /\bpass\b/i.test(verdict))) {
        missing.push('visual_verdict pass');
    }
    return missing.length === 0
        ? { passed: true, reason: 'component experiments include screenshot evidence and passing visual verdict' }
        : { passed: false, reason: `missing or invalid: ${missing.join(', ')}` };
}
function parseJsonObject(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        return objectValue(parsed);
    }
    catch {
        return undefined;
    }
}
function requireMeaningfulList(record, field, missing) {
    if (stringArrayValue(record[field]).length === 0)
        missing.push(field);
}
function requireStringFields(record, prefix, fields, missing) {
    if (!record) {
        missing.push(prefix);
        return;
    }
    for (const field of fields) {
        if (!hasMeaningfulString(record[field]))
            missing.push(`${prefix}.${field}`);
    }
}
function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function arrayValue(value) {
    return Array.isArray(value) ? value : undefined;
}
function stringArrayValue(value) {
    if (Array.isArray(value))
        return value.filter(hasMeaningfulString);
    return hasMeaningfulString(value) ? [value] : [];
}
function hasMeaningfulString(value) {
    return typeof value === 'string'
        && value.trim().length > 0
        && !/^(?:tbd|todo|placeholder|pending|none|\[\])$/i.test(value.trim());
}
function hasNonEmptyStructuredValue(value) {
    if (hasMeaningfulString(value))
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (typeof value === 'boolean')
        return true;
    if (Array.isArray(value))
        return value.some(hasNonEmptyStructuredValue);
    const record = objectValue(value);
    return record ? Object.values(record).some(hasNonEmptyStructuredValue) : false;
}
function pathExists(root, path) {
    return existsSync(resolve(root, path));
}
function creativeStatus(missingRequired) {
    if (missingRequired.includes('meaning-brief')
        || missingRequired.includes('inspiration-ledger')
        || missingRequired.includes('visual-expectation')) {
        return 'needs-brief';
    }
    if (missingRequired.includes('design-directions')
        || missingRequired.includes('motion-grammar')
        || missingRequired.includes('token-system')) {
        return 'needs-divergence';
    }
    if (missingRequired.includes('component-experiments')) {
        return 'needs-experiments';
    }
    if (missingRequired.includes('taste-gate')) {
        return 'needs-taste-gate';
    }
    return 'ready';
}
function recommendedCommands(goal, status) {
    const quotedGoal = JSON.stringify(goal ?? '<visual goal>');
    if (status === 'ready')
        return ['/product-pipeline "<core product slice>"'];
    if (status === 'needs-brief')
        return [`/creative-loop ${quotedGoal} --phase brief`];
    if (status === 'needs-divergence')
        return [`/creative-loop ${quotedGoal} --phase directions`];
    if (status === 'needs-experiments')
        return [`/creative-loop ${quotedGoal} --phase experiments`];
    return [`/creative-loop ${quotedGoal} --phase taste-gate`];
}
function templateFor(id, goal) {
    const title = goal ?? '<visual goal>';
    if (id === 'visual-expectation' || id === 'token-system' || id === 'component-experiments') {
        return `${JSON.stringify(templateJsonFor(id), null, 2)}\n`;
    }
    return [
        `# ${title}: ${id}`,
        '',
        'status: draft',
        '',
        templateBodyFor(id),
        '',
    ].join('\n');
}
function templateJsonFor(id) {
    if (id === 'visual-expectation') {
        return {
            schema_version: 1,
            status: 'draft',
            visual_expectation_contract: {
                desired_perception: [],
                category_codes_to_avoid: [],
                inspiration_principles: [],
                selected_direction: {
                    name: '',
                    rationale: '',
                    tradeoffs: '',
                },
                token_rationale: [],
                component_proofs: [],
                screenshot_evidence: [],
                not_ready_if: [],
            },
        };
    }
    if (id === 'token-system') {
        return {
            schema_version: 1,
            status: 'draft',
            color: {},
            type: {},
            spacing: {},
            radius: {},
            elevation: {},
            motion: {},
        };
    }
    return {
        schema_version: 1,
        status: 'draft',
        experiment: [],
        screenshot: [],
        visual_verdict: [],
    };
}
function templateBodyFor(id) {
    switch (id) {
        case 'meaning-brief':
            return [
                '## Feeling',
                '<what the product should make the user feel>',
                '',
                '## Understanding',
                '<what the product should make clear>',
                '',
                '## User State',
                '<before / during / after state>',
                '',
                '## Product Meaning',
                '<semantic consequence for UI>',
            ].join('\n');
        case 'inspiration-ledger':
            return [
                '## Sources',
                '- source: <reference>',
                '  - principle: <what to extract>',
                '  - constraint: <where this principle applies>',
                '  - what not to copy: <signature details to avoid>',
            ].join('\n');
        case 'design-directions':
            return [
                '## Direction 1',
                'hypothesis: <visual hypothesis>',
                'tradeoff: <what this direction gains and loses>',
                '',
                '## Direction 2',
                'hypothesis: <visual hypothesis>',
                'tradeoff: <what this direction gains and loses>',
                '',
                '## Direction 3',
                'hypothesis: <visual hypothesis>',
                'tradeoff: <what this direction gains and loses>',
            ].join('\n');
        case 'motion-grammar':
            return [
                '## State Changes',
                '- state: <state>',
                '  - why: <user/product reason>',
                '  - duration: <ms>',
                '  - easing: <curve>',
                '  - reduced motion: <fallback>',
            ].join('\n');
        case 'taste-gate':
            return [
                'verdict: draft',
                '',
                '## Distinctiveness',
                '<score and evidence>',
                '',
                '## Usability',
                '<score and evidence>',
                '',
                '## Accessibility',
                '<score and evidence>',
                '',
                '## Brand Fit',
                '<score and evidence>',
            ].join('\n');
        case 'design-system':
            return [
                '## Components',
                '<components promoted after taste gate>',
                '',
                '## Tokens',
                '<token usage>',
                '',
                '## Usage',
                '<rules and examples>',
            ].join('\n');
        default:
            return '';
    }
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=creative-loop.js.map
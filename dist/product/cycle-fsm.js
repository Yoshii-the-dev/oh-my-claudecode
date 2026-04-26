import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { validateProductPipelineContracts } from './pipeline-contract-validator.js';
import { CYCLE_DOCUMENT_RELATIVE_PATH, CYCLE_PROJECTION_RELATIVE_PATH, readCycleDocument, renderCycleProjection, writeCycleDocument, } from './cycle-document.js';
const LEARNING_RELATIVE_PATH = '.omc/learning/current.md';
const STAGES = ['discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn', 'complete'];
const STAGE_SET = new Set([...STAGES, 'blocked']);
const NEXT_STAGE = {
    discover: 'rank',
    rank: 'select',
    select: 'spec',
    spec: 'build',
    build: 'verify',
    verify: 'learn',
    learn: 'complete',
};
export function isProductCycleStage(value) {
    return STAGE_SET.has(value);
}
export function getProductCyclePath(root = process.cwd()) {
    return resolve(root, CYCLE_PROJECTION_RELATIVE_PATH);
}
export function readProductCycle(root = process.cwd()) {
    const resolvedRoot = resolve(root);
    const jsonPath = resolve(resolvedRoot, CYCLE_DOCUMENT_RELATIVE_PATH);
    const projectionPath = getProductCyclePath(resolvedRoot);
    if (existsSync(jsonPath)) {
        try {
            const document = readCycleDocument(resolvedRoot);
            if (!document)
                throw new Error(`Missing ${CYCLE_DOCUMENT_RELATIVE_PATH}`);
            const snapshot = snapshotFromDocument(resolvedRoot, jsonPath, document);
            const driftIssue = projectionDriftIssue(resolvedRoot, document);
            if (driftIssue)
                snapshot.issues.push(driftIssue);
            return snapshot;
        }
        catch (error) {
            return {
                exists: true,
                root: resolvedRoot,
                path: jsonPath,
                nextAction: 'Fix .omc/cycles/current.json or regenerate it from markdown with omc product-cycle migrate-document --write --force',
                issues: [{
                        severity: 'error',
                        code: 'invalid-cycle-document',
                        message: error instanceof Error ? error.message : String(error),
                    }],
            };
        }
    }
    if (!existsSync(projectionPath)) {
        return {
            exists: false,
            root: resolvedRoot,
            path: projectionPath,
            nextAction: 'Start a cycle: omc product-cycle advance --to discover --goal "<cycle goal>"',
            issues: [{
                    severity: 'warning',
                    code: 'missing-cycle',
                    message: `Missing ${CYCLE_PROJECTION_RELATIVE_PATH}`,
                }],
        };
    }
    const content = readFileSync(projectionPath, 'utf-8');
    const stage = parseStage(readField(content, 'cycle_stage'));
    const snapshot = {
        exists: true,
        root: resolvedRoot,
        path: projectionPath,
        cycleId: readField(content, 'cycle_id'),
        cycleGoal: readHeadingGoal(content) ?? readField(content, 'cycle_goal'),
        stage,
        productStage: readField(content, 'product_stage'),
        buildRoute: readField(content, 'build_route'),
        nextStage: stage ? NEXT_STAGE[stage] : undefined,
        nextAction: getNextAction(stage, content),
        issues: [],
    };
    if (!stage) {
        snapshot.issues.push({
            severity: 'error',
            code: 'missing-cycle-stage',
            message: 'Cycle artifact must include a valid cycle_stage field',
        });
    }
    return snapshot;
}
export function validateProductCycle(root = process.cwd()) {
    const snapshot = readProductCycle(root);
    if (!snapshot.exists)
        return snapshot;
    const report = validateProductPipelineContracts({ root, stage: 'cycle' });
    for (const issue of report.issues) {
        snapshot.issues.push({
            severity: issue.severity,
            code: issue.code,
            message: `${issue.artifact}: ${issue.message}`,
        });
    }
    if (snapshot.stage === 'complete' && !existsSync(resolve(snapshot.root, LEARNING_RELATIVE_PATH))) {
        snapshot.issues.push({
            severity: 'error',
            code: 'complete-learning-missing',
            message: `Completed cycle requires ${LEARNING_RELATIVE_PATH}`,
        });
    }
    return snapshot;
}
export function advanceProductCycle(options) {
    const root = resolve(options.root ?? process.cwd());
    const to = options.to;
    const before = readProductCycle(root);
    const issues = [];
    if (!before.exists) {
        if (to !== 'discover') {
            issues.push({
                severity: 'error',
                code: 'missing-cycle',
                message: `Cannot advance to ${to}; start with discover first`,
            });
            return { ok: false, to, snapshot: before, issues };
        }
        writeCycleDocument(root, createCycleDocumentTemplate(options.goal ?? 'product learning cycle'));
        const created = readProductCycle(root);
        return { ok: true, to, snapshot: created, issues: [] };
    }
    if (!before.stage) {
        issues.push({
            severity: 'error',
            code: 'unknown-current-stage',
            message: 'Cannot advance because current cycle_stage is missing or invalid',
        });
        return { ok: false, to, snapshot: before, issues };
    }
    if (!options.force && !isLegalTransition(before.stage, to)) {
        issues.push({
            severity: 'error',
            code: 'illegal-transition',
            message: `Illegal transition ${before.stage} -> ${to}. Expected ${NEXT_STAGE[before.stage] ?? 'no automatic next stage'}`,
        });
    }
    issues.push(...transitionGuardIssues(root, before.stage, to));
    if (issues.some((issue) => issue.severity === 'error')) {
        return { ok: false, from: before.stage, to, snapshot: before, issues };
    }
    if (before.path.endsWith(CYCLE_DOCUMENT_RELATIVE_PATH)) {
        const document = readCycleDocument(root);
        if (!document) {
            issues.push({
                severity: 'error',
                code: 'missing-cycle-document',
                message: `Cannot advance because ${CYCLE_DOCUMENT_RELATIVE_PATH} could not be read`,
            });
            return { ok: false, from: before.stage, to, snapshot: before, issues };
        }
        writeCycleDocument(root, updateCycleDocumentStage(document, to));
    }
    else {
        const content = readFileSync(before.path, 'utf-8');
        writeCycle(root, updateCycleStage(content, to));
    }
    const after = readProductCycle(root);
    return { ok: true, from: before.stage, to, snapshot: after, issues };
}
export function getNextProductCycleAction(root = process.cwd()) {
    return readProductCycle(root);
}
function transitionGuardIssues(root, from, to) {
    const issues = [];
    if (from === 'discover' && to === 'rank') {
        const report = validateProductPipelineContracts({ root, stage: 'discovery-handoff' });
        if (!report.ok) {
            issues.push({
                severity: 'error',
                code: 'discovery-contract-failed',
                message: 'Cannot rank before discovery-handoff contract passes',
            });
        }
    }
    if (from === 'rank' && to === 'select') {
        const report = validateProductPipelineContracts({ root, stage: 'priority-handoff' });
        if (!report.ok) {
            issues.push({
                severity: 'error',
                code: 'priority-contract-failed',
                message: 'Cannot select before priority-handoff contract passes',
            });
        }
    }
    if (from === 'spec' && to === 'build') {
        const report = validateProductPipelineContracts({ root, stage: 'cycle' });
        if (!report.ok) {
            issues.push({
                severity: 'error',
                code: 'cycle-contract-failed',
                message: 'Cannot build before cycle contract passes',
            });
        }
    }
    if (from === 'learn' && to === 'complete' && !existsSync(resolve(root, LEARNING_RELATIVE_PATH))) {
        issues.push({
            severity: 'error',
            code: 'learning-missing',
            message: `Cannot complete before ${LEARNING_RELATIVE_PATH} exists`,
        });
    }
    return issues;
}
function isLegalTransition(from, to) {
    if (to === 'blocked')
        return from !== 'complete';
    return NEXT_STAGE[from] === to;
}
function writeCycle(root, content) {
    const path = getProductCyclePath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
}
function createCycleDocumentTemplate(goal) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(goal);
    return {
        schema_version: 1,
        cycle_id: `${date}-${slug}`,
        cycle_goal: goal,
        cycle_stage: 'discover',
        product_stage: 'pre-mvp',
        stage_checklist: {
            discover: false,
            rank: false,
            select: false,
            spec: false,
            build: false,
            verify: false,
            learn: false,
        },
        selected_portfolio: {
            core_product_slice: 'TBD',
            enabling_task: 'TBD',
            learning_task: 'TBD',
        },
        spec: {
            acceptance_criteria: ['TBD'],
            build_route: 'blocked',
            verification_plan: ['TBD'],
            learning_plan: ['TBD'],
            experience_gate: '.omc/experience/current.md',
        },
        footer: {
            status: 'needs-research',
            evidence: [CYCLE_DOCUMENT_RELATIVE_PATH],
            confidence: 0.2,
            blocking_issues: ['discovery not complete'],
            next_action: `/product-foundation "${goal}" --foundation-lite`,
            artifacts_written: [CYCLE_DOCUMENT_RELATIVE_PATH, CYCLE_PROJECTION_RELATIVE_PATH],
        },
        history: [],
        updated_at: new Date().toISOString(),
    };
}
function updateCycleStage(content, stage) {
    let updated = content.match(/^\s*cycle_stage:/im)
        ? content.replace(/^\s*cycle_stage:\s*[a-z-]+/im, `cycle_stage: ${stage}`)
        : `${content.trimEnd()}\ncycle_stage: ${stage}\n`;
    for (const loopStage of STAGES.filter((item) => item !== 'complete')) {
        const checked = shouldCheckStage(loopStage, stage);
        const pattern = new RegExp(`^- \\[[ xX]\\] ${escapeRegExp(loopStage)}$`, 'm');
        if (pattern.test(updated)) {
            updated = updated.replace(pattern, `- [${checked ? 'x' : ' '}] ${loopStage}`);
        }
    }
    const nextAction = getNextAction(stage, updated);
    updated = updated.match(/^\s*next_action:/im)
        ? updated.replace(/^\s*next_action:\s*.*$/im, `next_action: ${nextAction}`)
        : `${updated.trimEnd()}\nnext_action: ${nextAction}\n`;
    if (stage === 'blocked') {
        updated = updated.match(/^\s*status:/im)
            ? updated.replace(/^\s*status:\s*.*$/im, 'status: blocked')
            : `${updated.trimEnd()}\nstatus: blocked\n`;
    }
    else if (stage === 'complete') {
        updated = updated.match(/^\s*status:/im)
            ? updated.replace(/^\s*status:\s*.*$/im, 'status: ok')
            : `${updated.trimEnd()}\nstatus: ok\n`;
    }
    return updated.endsWith('\n') ? updated : `${updated}\n`;
}
function snapshotFromDocument(root, path, document) {
    const stage = parseStage(document.cycle_stage);
    return {
        exists: true,
        root,
        path,
        cycleId: document.cycle_id,
        cycleGoal: document.cycle_goal,
        stage,
        productStage: document.product_stage,
        buildRoute: document.spec.build_route,
        nextStage: stage ? NEXT_STAGE[stage] : undefined,
        nextAction: getNextAction(stage, renderCycleProjection(document)),
        issues: [],
    };
}
function projectionDriftIssue(root, document) {
    const projectionPath = resolve(root, CYCLE_PROJECTION_RELATIVE_PATH);
    if (!existsSync(projectionPath)) {
        return {
            severity: 'warning',
            code: 'missing-cycle-projection',
            message: `Missing ${CYCLE_PROJECTION_RELATIVE_PATH}; run omc product-cycle project-document`,
        };
    }
    const expected = normalizeProjection(renderCycleProjection(document));
    const actual = normalizeProjection(readFileSync(projectionPath, 'utf-8'));
    if (expected === actual)
        return undefined;
    return {
        severity: 'warning',
        code: 'cycle-projection-drift',
        message: `${CYCLE_PROJECTION_RELATIVE_PATH} differs from ${CYCLE_DOCUMENT_RELATIVE_PATH}; run omc product-cycle project-document`,
    };
}
function normalizeProjection(content) {
    return content.trim().replace(/\r\n/g, '\n');
}
function updateCycleDocumentStage(document, stage) {
    const updated = {
        ...document,
        cycle_stage: stage,
        stage_checklist: { ...document.stage_checklist },
        footer: {
            ...document.footer,
            next_action: getNextAction(stage, renderCycleProjection(document)),
            artifacts_written: Array.from(new Set([
                ...document.footer.artifacts_written,
                CYCLE_DOCUMENT_RELATIVE_PATH,
                CYCLE_PROJECTION_RELATIVE_PATH,
            ])),
        },
        history: [
            ...document.history,
            {
                stage,
                at: new Date().toISOString(),
                note: 'omc product-cycle advance',
            },
        ],
        updated_at: new Date().toISOString(),
    };
    const checklistStages = STAGES.filter((item) => (item !== 'complete' && item !== 'blocked'));
    for (const loopStage of checklistStages) {
        updated.stage_checklist[loopStage] = shouldCheckStage(loopStage, stage);
    }
    if (stage === 'blocked') {
        updated.footer.status = 'blocked';
    }
    else if (stage === 'complete') {
        updated.footer.status = 'ok';
    }
    return updated;
}
function shouldCheckStage(loopStage, currentStage) {
    if (currentStage === 'complete')
        return true;
    if (currentStage === 'blocked')
        return false;
    const currentIndex = STAGES.indexOf(currentStage);
    const loopIndex = STAGES.indexOf(loopStage);
    return currentIndex >= loopIndex && currentIndex >= 0 && loopIndex >= 0;
}
function getNextAction(stage, content) {
    const goal = readHeadingGoal(content) ?? readField(content, 'cycle_goal') ?? '<cycle goal>';
    const buildRoute = readField(content, 'build_route') ?? 'blocked';
    switch (stage) {
        case 'discover':
            return `/product-foundation "${goal}" --foundation-lite`;
        case 'rank':
            return `/priority-engine "${goal}" && omc portfolio validate && omc doctor product-contracts --stage priority-handoff`;
        case 'select':
            return 'Select core_product_slice, enabling_task, and learning_task from .omc/portfolio/current.json';
        case 'spec':
            return 'Write acceptance_criteria, build_route, verification_plan, learning_plan, run /product-experience-gate, then run omc doctor product-contracts --stage cycle';
        case 'build':
            return buildRoute === 'backend-pipeline'
                ? '/backend-pipeline "<enabling task>"'
                : buildRoute === 'both'
                    ? '/backend-pipeline "<enabling task>" then /product-pipeline "<core product slice>"'
                    : '/product-pipeline "<core product slice>"';
        case 'verify':
            return 'Run tests/audits/verifier against cycle acceptance criteria';
        case 'learn':
            return `Write ${LEARNING_RELATIVE_PATH}, then run omc product-cycle advance --to complete`;
        case 'complete':
            return 'Cycle complete. Start the next cycle with omc product-cycle advance --to discover --goal "<next goal>" --force';
        case 'blocked':
            return 'Resolve blocking_issues, then advance with --force only when the blocker is explicitly cleared';
        default:
            return 'Start a cycle: omc product-cycle advance --to discover --goal "<cycle goal>"';
    }
}
function readField(content, field) {
    const match = content.match(new RegExp(`^\\s*${escapeRegExp(field)}:\\s*(.+?)\\s*$`, 'im'));
    return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}
function readHeadingGoal(content) {
    const match = content.match(/^#\s+Product Cycle:\s*(.+?)\s*$/im);
    return match?.[1]?.trim();
}
function parseStage(raw) {
    if (!raw)
        return undefined;
    const normalized = raw.toLowerCase();
    return isProductCycleStage(normalized) ? normalized : undefined;
}
function slugify(input) {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || 'cycle';
}
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=cycle-fsm.js.map
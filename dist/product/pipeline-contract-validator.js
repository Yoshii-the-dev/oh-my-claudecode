import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PRODUCT_ARTIFACT_PATHS, PRODUCT_STANDARD_FOOTER_FIELDS, } from './pipeline-registry.js';
import { CYCLE_DOCUMENT_RELATIVE_PATH, readCycleDocument, renderCycleProjection, validateCycleDocument, } from './cycle-document.js';
export function validateProductPipelineContracts(options = {}) {
    const root = resolve(options.root ?? process.cwd());
    const stage = options.stage ?? 'foundation-lite';
    const contracts = buildContracts(stage);
    const artifacts = contracts.map((contract) => validateArtifact(root, contract));
    applyCrossArtifactContracts(root, stage, artifacts);
    const issues = artifacts.flatMap((artifact) => artifact.issues);
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    return {
        ok: errors === 0,
        root,
        stage,
        artifacts,
        issues,
        summary: { errors, warnings },
    };
}
function buildContracts(stage) {
    const capability = (required) => ({
        artifact: 'capability-map',
        relativePath: PRODUCT_ARTIFACT_PATHS['capability-map'],
        required,
        validate: validateCapabilityMap,
    });
    const meaning = (required) => ({
        artifact: 'meaning',
        relativePath: PRODUCT_ARTIFACT_PATHS.meaning,
        required,
        validate: validateMeaningGraph,
    });
    const ecosystem = (required) => ({
        artifact: 'ecosystem',
        relativePath: PRODUCT_ARTIFACT_PATHS.ecosystem,
        required,
        validate: validateEcosystemMap,
    });
    const opportunities = () => ({
        artifact: 'opportunities',
        relativePath: PRODUCT_ARTIFACT_PATHS.opportunities,
        required: true,
        validate: validateOpportunities,
    });
    const portfolioLedger = () => ({
        artifact: 'portfolio-ledger',
        relativePath: PRODUCT_ARTIFACT_PATHS['portfolio-ledger'],
        required: true,
        validate: validatePortfolioLedgerArtifact,
    });
    const roadmap = () => ({
        artifact: 'roadmap',
        relativePath: PRODUCT_ARTIFACT_PATHS.roadmap,
        required: true,
        validate: validateRoadmap,
    });
    const cycle = () => ({
        artifact: 'cycle',
        relativePath: PRODUCT_ARTIFACT_PATHS.cycle,
        required: true,
        validate: validateCycle,
    });
    const experienceGate = (required) => ({
        artifact: 'experience-gate',
        relativePath: PRODUCT_ARTIFACT_PATHS['experience-gate'],
        required,
        validate: validateExperienceGate,
    });
    const learning = (required) => ({
        artifact: 'learning',
        relativePath: PRODUCT_ARTIFACT_PATHS.learning,
        required,
        validate: validateLearning,
    });
    if (stage === 'discovery-handoff') {
        return [capability(true), meaning(false), ecosystem(true)];
    }
    if (stage === 'priority-handoff') {
        return [portfolioLedger(), opportunities(), roadmap()];
    }
    if (stage === 'technology-handoff') {
        return [capability(true), portfolioLedger(), opportunities(), roadmap()];
    }
    if (stage === 'cycle') {
        return [portfolioLedger(), opportunities(), roadmap(), cycle(), experienceGate(false), learning(false)];
    }
    if (stage === 'foundation-lite') {
        return [capability(true), meaning(false), ecosystem(true), portfolioLedger(), opportunities(), roadmap()];
    }
    return [capability(true), meaning(true), ecosystem(true), portfolioLedger(), opportunities(), roadmap(), cycle(), experienceGate(true), learning(true)];
}
function validateArtifact(root, contract) {
    const cycleDocumentPath = resolve(root, CYCLE_DOCUMENT_RELATIVE_PATH);
    const useCycleDocument = contract.artifact === 'cycle' && existsSync(cycleDocumentPath);
    const path = useCycleDocument ? cycleDocumentPath : resolve(root, contract.relativePath);
    const result = {
        artifact: contract.artifact,
        path,
        exists: existsSync(path),
        metrics: {},
        issues: [],
    };
    if (!result.exists) {
        addIssue(result, contract.required ? 'error' : 'warning', 'missing-artifact', `Missing ${contract.relativePath}`);
        return result;
    }
    let content = '';
    try {
        if (useCycleDocument) {
            const documentReport = validateCycleDocument(root);
            for (const issue of documentReport.issues) {
                addIssue(result, issue.severity, issue.code, issue.message);
            }
            const document = readCycleDocument(root);
            if (!document) {
                addIssue(result, 'error', 'missing-cycle-document', `Cannot read ${CYCLE_DOCUMENT_RELATIVE_PATH}`);
                return result;
            }
            content = renderCycleProjection(document);
        }
        else {
            content = readFileSync(path, 'utf-8');
        }
    }
    catch (error) {
        addIssue(result, 'error', 'unreadable-artifact', `Cannot read ${contract.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        return result;
    }
    if (content.trim().length === 0) {
        addIssue(result, 'error', 'empty-artifact', `${contract.relativePath} is empty`);
        return result;
    }
    contract.validate(content, result);
    return result;
}
function applyCrossArtifactContracts(root, stage, artifacts) {
    if (stage !== 'cycle' && stage !== 'all')
        return;
    const cycleContent = readCycleContractContent(root);
    const userFacing = isUserFacingCycle(cycleContent);
    let experience = artifacts.find((artifact) => artifact.artifact === 'experience-gate');
    if (userFacing && (!experience || !experience.exists)) {
        if (!experience) {
            experience = createVirtualArtifactResult('experience-gate', resolve(root, PRODUCT_ARTIFACT_PATHS['experience-gate']));
            artifacts.push(experience);
        }
        addIssue(experience, 'error', 'missing-experience-gate', 'User-facing cycles must pass .omc/experience/current.md before build');
    }
    const portfolioPath = resolve(root, PRODUCT_ARTIFACT_PATHS['portfolio-ledger']);
    const roadmapPath = resolve(root, PRODUCT_ARTIFACT_PATHS.roadmap);
    if (!existsSync(portfolioPath) || !existsSync(roadmapPath))
        return;
    const portfolio = artifacts.find((artifact) => artifact.artifact === 'portfolio-ledger');
    const activeCycleId = readField(cycleContent, 'cycle_id');
    if (portfolio && activeCycleId) {
        for (const selectedCycle of selectedCycleIds(portfolioPath)) {
            if (selectedCycle !== activeCycleId) {
                addIssue(portfolio, 'error', 'selected-cycle-mismatch', `Selected item cycle ${selectedCycle} does not match active cycle_id ${activeCycleId}`);
            }
        }
    }
    const researchDebt = portfolioHasSelectedResearchDebt(portfolioPath);
    const roadmapContent = safeRead(roadmapPath);
    const roadmap = artifacts.find((artifact) => artifact.artifact === 'roadmap');
    if (researchDebt && roadmap && !/\b(research debt|learning gate|research gate|learning\/research task)\b/i.test(roadmapContent)) {
        addIssue(roadmap, 'error', 'research-debt-missing-from-roadmap', 'Weak evidence in selected work must be carried as research debt in the rolling roadmap');
    }
}
function createVirtualArtifactResult(artifact, path) {
    return {
        artifact,
        path,
        exists: false,
        metrics: {},
        issues: [],
    };
}
function safeRead(path) {
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return '';
    }
}
function readCycleContractContent(root) {
    const cycleDocumentPath = resolve(root, CYCLE_DOCUMENT_RELATIVE_PATH);
    if (existsSync(cycleDocumentPath)) {
        try {
            const document = readCycleDocument(root);
            return document ? renderCycleProjection(document) : '';
        }
        catch {
            return '';
        }
    }
    const cyclePath = resolve(root, PRODUCT_ARTIFACT_PATHS.cycle);
    return existsSync(cyclePath) ? safeRead(cyclePath) : '';
}
function isUserFacingCycle(content) {
    const route = extractBuildRoute(content);
    if (route === 'backend-pipeline')
        return false;
    if (route === 'product-pipeline' || route === 'both')
        return true;
    return containsAny(content, [
        'user journey',
        'user-facing',
        'user_visible: true',
        'reader',
        'editor',
        'onboarding',
        'screen',
    ]);
}
function portfolioHasSelectedResearchDebt(path) {
    try {
        const ledger = JSON.parse(readFileSync(path, 'utf-8'));
        const items = Array.isArray(ledger.items) ? ledger.items : [];
        return items.some((item) => {
            const selected = typeof item.selected_cycle === 'string' && item.selected_cycle.length > 0;
            const weak = isWeakConfidence(item.confidence);
            const research = item.lane === 'research' || item.type === 'learning' || item.type === 'research';
            return selected && weak && !research;
        });
    }
    catch {
        return false;
    }
}
function selectedCycleIds(path) {
    try {
        const ledger = JSON.parse(readFileSync(path, 'utf-8'));
        const items = Array.isArray(ledger.items) ? ledger.items : [];
        return Array.from(new Set(items
            .map((item) => item.selected_cycle)
            .filter((value) => typeof value === 'string' && value.length > 0)));
    }
    catch {
        return [];
    }
}
function validateCapabilityMap(content, result) {
    requireTerms(result, content, 'capability-required-sections', [
        'MVP Feature Set',
        'First Usable Loop',
        'Required Product Systems',
        'Retention',
        'Launch Readiness',
        'Backend/Product Split',
    ]);
    if (hasRequestedNextAgent(content, 'technology-strategist') && !hasRequestedNextAgent(content, 'priority-engine')) {
        addIssue(result, 'error', 'technology-before-priority', 'Capability map routes directly to technology-strategist without a priority-engine handoff');
    }
    result.metrics.hasFirstUsableLoop = containsAny(content, ['first usable loop', 'usable loop']);
    validateHandoffBasics(content, result, false);
}
function validateMeaningGraph(content, result) {
    requireTerms(result, content, 'meaning-required-sections', [
        'User Meanings',
        'Category Codes',
        'Enemy Moves',
        'Symbolic Assets',
        'Content Angles',
    ]);
    if (wordCount(content) > 1800) {
        addIssue(result, 'warning', 'meaning-too-long', 'Meaning graph is over 1800 words; keep it compact enough for downstream agents');
    }
}
function validateEcosystemMap(content, result) {
    requireTerms(result, content, 'ecosystem-required-layers', [
        'app surfaces',
        'content loops',
        'data loops',
        'distribution loops',
        'integrations',
        'research loop',
    ]);
    requireTerms(result, content, 'ecosystem-depth-path', [
        'v0',
        'v1',
        'v2',
        'research gate',
    ]);
    validateStandardFooter(content, result);
}
function validateOpportunities(content, result) {
    const status = extractStatus(content);
    const candidateCount = countCandidateMoves(content);
    const selectedPortfolioPresent = containsAll(content, [
        'core product slice',
        'enabling task',
        'learning',
    ]);
    const lanes = countKnownLanes(content);
    const minCandidates = status === 'needs-research' ? 12 : 20;
    result.metrics.status = status ?? 'unknown';
    result.metrics.candidateCount = candidateCount;
    result.metrics.laneCount = lanes;
    result.metrics.selectedPortfolioPresent = selectedPortfolioPresent;
    if (candidateCount < minCandidates) {
        addIssue(result, 'error', 'too-few-candidates', `Expected at least ${minCandidates} candidate moves for status=${status ?? 'unknown'}, found ${candidateCount}`);
    }
    if (candidateCount > 40) {
        addIssue(result, 'error', 'too-many-candidates', `Expected at most 40 candidate moves, found ${candidateCount}`);
    }
    if (lanes < 5) {
        addIssue(result, 'error', `too-few-lanes`, `Expected candidate moves across at least 5 lanes, found ${lanes}`);
    }
    if (!selectedPortfolioPresent) {
        addIssue(result, 'error', 'missing-cycle-portfolio', 'Missing selected cycle portfolio with core product slice, enabling task, and learning/research task');
    }
    validateStandardFooter(content, result);
}
function validatePortfolioLedgerArtifact(content, result) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        addIssue(result, 'error', 'invalid-json', `Portfolio ledger is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (!parsed || typeof parsed !== 'object') {
        addIssue(result, 'error', 'invalid-portfolio-ledger', 'Portfolio ledger must be a JSON object');
        return;
    }
    const ledger = parsed;
    if (ledger.schema_version !== 1) {
        addIssue(result, 'error', 'invalid-portfolio-schema', 'Portfolio ledger schema_version must be 1');
    }
    if (typeof ledger.updated_at !== 'string' || Number.isNaN(Date.parse(ledger.updated_at))) {
        addIssue(result, 'error', 'invalid-portfolio-updated-at', 'Portfolio ledger updated_at must be an ISO timestamp');
    }
    if (!Array.isArray(ledger.source_artifacts)) {
        addIssue(result, 'error', 'invalid-portfolio-sources', 'Portfolio ledger source_artifacts must be an array');
    }
    if (!Array.isArray(ledger.items)) {
        addIssue(result, 'error', 'invalid-portfolio-items', 'Portfolio ledger items must be an array');
        return;
    }
    const items = ledger.items;
    const lanes = new Set();
    const selectedCycles = new Map();
    const selectedByCycle = new Map();
    const ids = new Set();
    let evidenceBacked = 0;
    const selectedResearchByCycle = new Map();
    const weakSelectedByCycle = new Map();
    for (const [index, item] of items.entries()) {
        const id = item.id;
        const lane = item.lane;
        const status = item.status;
        const selectedCycle = item.selected_cycle;
        const evidence = item.evidence;
        const confidence = item.confidence;
        const type = item.type;
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
            addIssue(result, 'error', 'invalid-portfolio-id', `Portfolio item ${index} id must be kebab-case`);
        }
        else if (ids.has(id)) {
            addIssue(result, 'error', 'duplicate-portfolio-id', `Duplicate portfolio item id: ${id}`);
        }
        else {
            ids.add(id);
        }
        if (typeof lane === 'string')
            lanes.add(lane);
        if (typeof status !== 'string') {
            addIssue(result, 'error', 'invalid-portfolio-status', `Portfolio item ${id ?? index} status must be a string`);
        }
        if (!(Array.isArray(evidence) && evidence.length > 0)) {
            addIssue(result, 'error', 'missing-portfolio-evidence', `Portfolio item ${id ?? index} must include evidence`);
        }
        else {
            evidenceBacked += 1;
        }
        if (typeof selectedCycle === 'string' && selectedCycle.length > 0) {
            selectedCycles.set(selectedCycle, (selectedCycles.get(selectedCycle) ?? 0) + 1);
            const selectedItems = selectedByCycle.get(selectedCycle) ?? [];
            selectedItems.push(item);
            selectedByCycle.set(selectedCycle, selectedItems);
            if (lane === 'research' || type === 'learning' || type === 'research') {
                selectedResearchByCycle.set(selectedCycle, (selectedResearchByCycle.get(selectedCycle) ?? 0) + 1);
            }
            if (isWeakConfidence(confidence) && lane !== 'research' && type !== 'learning' && type !== 'research') {
                weakSelectedByCycle.set(selectedCycle, (weakSelectedByCycle.get(selectedCycle) ?? 0) + 1);
            }
        }
        else if (selectedCycle !== null) {
            addIssue(result, 'error', 'invalid-selected-cycle', `Portfolio item ${id ?? index} selected_cycle must be string or null`);
        }
    }
    result.metrics.itemCount = items.length;
    result.metrics.laneCount = lanes.size;
    result.metrics.evidenceBackedItems = evidenceBacked;
    result.metrics.selectedItems = [...selectedCycles.values()].reduce((total, count) => total + count, 0);
    if (items.length < 20) {
        addIssue(result, 'error', 'portfolio-too-small', `Expected at least 20 portfolio items, found ${items.length}`);
    }
    if (items.length > 40) {
        addIssue(result, 'error', 'portfolio-too-large', `Expected at most 40 portfolio items, found ${items.length}`);
    }
    if (lanes.size < 5) {
        addIssue(result, 'error', 'portfolio-too-few-lanes', `Expected portfolio items across at least 5 lanes, found ${lanes.size}`);
    }
    if (selectedByCycle.size === 0) {
        addIssue(result, 'error', 'missing-selected-cycle-trio', 'Portfolio ledger must select exactly three items for the next cycle');
    }
    for (const [cycle, selectedItems] of selectedByCycle.entries()) {
        if (selectedItems.length !== 3) {
            addIssue(result, 'error', 'invalid-selected-cycle-size', `Cycle ${cycle} has ${selectedItems.length} selected items; expected exactly 3`);
        }
        const core = selectedItems.filter((item) => item.type === 'core-product-slice');
        const enabling = selectedItems.filter((item) => item.type === 'enabling');
        const learning = selectedItems.filter((item) => item.type === 'learning' || item.type === 'research');
        if (core.length !== 1 || enabling.length !== 1 || learning.length !== 1) {
            addIssue(result, 'error', 'invalid-selected-cycle-trio', `Cycle ${cycle} must select exactly one core-product-slice, one enabling, and one learning/research item`);
        }
    }
    for (const [cycle, count] of weakSelectedByCycle.entries()) {
        if ((selectedResearchByCycle.get(cycle) ?? 0) === 0) {
            addIssue(result, 'error', 'missing-research-debt-task', `Cycle ${cycle} has ${count} weak-confidence selected item(s) but no selected research/learning debt task`);
        }
    }
}
function validateRoadmap(content, result) {
    const hasTwoWeek = /(?:^|\b)(?:2|two)[ -]?(?:week|weeks)\b/i.test(content);
    const hasSixWeek = /(?:^|\b)(?:6|six)[ -]?(?:week|weeks)\b/i.test(content);
    const hasTwelveWeek = /(?:^|\b)(?:12|twelve)[ -]?(?:week|weeks)\b/i.test(content);
    result.metrics.hasTwoWeek = hasTwoWeek;
    result.metrics.hasSixWeek = hasSixWeek;
    result.metrics.hasTwelveWeek = hasTwelveWeek;
    if (!hasTwoWeek || !hasSixWeek || !hasTwelveWeek) {
        addIssue(result, 'error', 'missing-rolling-windows', 'Roadmap must include rolling 2/6/12-week windows');
    }
    if (/24[ -]?week/i.test(content)) {
        addIssue(result, 'warning', 'fixed-long-roadmap', 'Roadmap mentions 24-week planning; keep product roadmap rolling rather than fixed long-range planning');
    }
    validateStandardFooter(content, result);
}
function validateExperienceGate(content, result) {
    requireTerms(result, content, 'experience-required-sections', [
        'User Journey',
        'Empty States',
        'Failure States',
        'Return Session',
        'Perceived Value',
        'UX Verdict',
    ]);
    const verdict = extractUxVerdict(content);
    result.metrics.uxVerdict = verdict ?? 'unknown';
    if (verdict !== 'pass') {
        addIssue(result, 'error', 'experience-gate-not-passed', 'Experience gate UX Verdict must be exactly pass before user-facing build');
    }
    validateStandardFooter(content, result);
}
function validateCycle(content, result) {
    requireTerms(result, content, 'cycle-required-loop-stages', [
        'discover',
        'rank',
        'select',
        'spec',
        'build',
        'verify',
        'learn',
    ]);
    requireTerms(result, content, 'cycle-required-portfolio', [
        'core_product_slice',
        'enabling_task',
        'learning_task',
    ]);
    requireTerms(result, content, 'cycle-required-spec', [
        'acceptance_criteria',
        'build_route',
        'verification_plan',
        'learning_plan',
        'experience_gate',
    ]);
    const stage = extractCycleStage(content);
    const buildRoute = extractBuildRoute(content);
    result.metrics.cycleStage = stage ?? 'unknown';
    result.metrics.buildRoute = buildRoute ?? 'unknown';
    if (!stage) {
        addIssue(result, 'error', 'missing-cycle-stage', 'Cycle artifact must include cycle_stage');
    }
    validateCyclePortfolioValues(content, result);
    validateCycleSpecValues(content, result);
    if (!buildRoute || !['product-pipeline', 'backend-pipeline', 'both'].includes(buildRoute)) {
        addIssue(result, 'error', 'invalid-build-route', 'build_route must be one of product-pipeline, backend-pipeline, or both before build');
    }
    if (stage === 'complete' && !containsTerm(content, '.omc/learning/current.md')) {
        addIssue(result, 'error', 'complete-without-learning', 'Completed cycle must reference .omc/learning/current.md');
    }
    validateStandardFooter(content, result);
}
function validateLearning(content, result) {
    requireTerms(result, content, 'learning-required-sections', [
        'shipped outcome',
        'evidence collected',
        'user/product learning',
        'invalidated assumptions',
        'recommended next cycle',
    ]);
    validateStandardFooter(content, result);
}
function validateStandardFooter(content, result) {
    const missing = PRODUCT_STANDARD_FOOTER_FIELDS.filter((field) => !hasFooterField(content, field));
    if (missing.length > 0) {
        addIssue(result, 'error', 'missing-standard-footer', `Missing standard footer fields: ${missing.join(', ')}`);
    }
    const status = readField(content, 'status');
    const confidence = readField(content, 'confidence');
    const nextAction = readField(content, 'next_action');
    const evidence = readListOrInline(content, 'evidence');
    const artifacts = readListOrInline(content, 'artifacts_written');
    if (status !== undefined && isPlaceholderValue(status)) {
        addIssue(result, 'error', 'placeholder-footer-status', 'status must not be empty or placeholder');
    }
    if (confidence !== undefined && isPlaceholderValue(confidence)) {
        addIssue(result, 'error', 'placeholder-footer-confidence', 'confidence must not be empty or placeholder');
    }
    if (nextAction !== undefined && isPlaceholderValue(nextAction)) {
        addIssue(result, 'error', 'placeholder-footer-next-action', 'next_action must not be empty or placeholder');
    }
    if (hasFooterField(content, 'evidence:') && evidence.length === 0) {
        addIssue(result, 'error', 'empty-footer-evidence', 'evidence must include at least one entry');
    }
    if (hasFooterField(content, 'artifacts_written:') && artifacts.length === 0) {
        addIssue(result, 'error', 'empty-footer-artifacts-written', 'artifacts_written must include at least one entry');
    }
}
function validateHandoffBasics(content, result, required) {
    const hasHandoff = containsAll(content, ['run_id:', 'agent_role:', 'requested_next_agent:', 'artifacts_produced:']);
    result.metrics.hasHandoffEnvelope = hasHandoff;
    if (required && !hasHandoff) {
        addIssue(result, 'error', 'missing-handoff-envelope', 'Missing minimal handoff envelope fields');
    }
}
function requireTerms(result, content, code, terms) {
    const missing = terms.filter((term) => !containsTerm(content, term));
    if (missing.length > 0) {
        addIssue(result, 'error', code, `Missing required terms/sections: ${missing.join(', ')}`);
    }
}
function addIssue(result, severity, code, message) {
    result.issues.push({
        severity,
        artifact: result.artifact,
        code,
        message,
    });
}
function containsTerm(content, term) {
    return content.toLowerCase().includes(term.toLowerCase());
}
function containsAny(content, terms) {
    return terms.some((term) => containsTerm(content, term));
}
function containsAll(content, terms) {
    return terms.every((term) => containsTerm(content, term));
}
function hasRequestedNextAgent(content, agent) {
    return new RegExp(`requested_next_agent:\\s*['"]?${escapeRegExp(agent)}['"]?`, 'i').test(content);
}
function extractStatus(content) {
    const match = content.match(/^\s*status:\s*([a-z-]+)/im);
    return match?.[1]?.toLowerCase();
}
function extractCycleStage(content) {
    const match = content.match(/^\s*cycle_stage:\s*([a-z-]+)/im);
    return match?.[1]?.toLowerCase();
}
function extractBuildRoute(content) {
    const match = content.match(/^\s*build_route:\s*([a-z-]+)/im);
    return match?.[1]?.toLowerCase();
}
function extractUxVerdict(content) {
    const section = content.match(/(?:^|\n)#{1,6}\s*UX Verdict\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i)?.[1];
    const source = section ?? readField(content, 'ux_verdict') ?? '';
    const firstLine = source
        .split('\n')
        .map((line) => line.replace(/^[-*]\s*/, '').trim())
        .find((line) => line.length > 0);
    const match = firstLine?.match(/^(pass|blocked|needs-research)\b/i);
    return match?.[1]?.toLowerCase();
}
function validateCyclePortfolioValues(content, result) {
    const fields = ['core_product_slice', 'enabling_task', 'learning_task'];
    for (const field of fields) {
        const value = readField(content, field);
        if (!value || isPlaceholderValue(value)) {
            addIssue(result, 'error', 'placeholder-cycle-portfolio', `${field} must be selected before build`);
        }
    }
}
function validateCycleSpecValues(content, result) {
    const acceptanceCriteria = readListOrInline(content, 'acceptance_criteria');
    const verificationPlan = readListOrInline(content, 'verification_plan');
    const learningPlan = readListOrInline(content, 'learning_plan');
    result.metrics.acceptanceCriteriaCount = acceptanceCriteria.length;
    result.metrics.verificationPlanCount = verificationPlan.length;
    result.metrics.learningPlanCount = learningPlan.length;
    if (acceptanceCriteria.length === 0) {
        addIssue(result, 'error', 'missing-acceptance-criteria', 'acceptance_criteria must include at least one testable criterion');
    }
    if (verificationPlan.length === 0) {
        addIssue(result, 'error', 'missing-verification-plan', 'verification_plan must include at least one concrete verification step');
    }
    if (learningPlan.length === 0) {
        addIssue(result, 'error', 'missing-learning-plan', 'learning_plan must include at least one learning capture step');
    }
    for (const value of [...acceptanceCriteria, ...verificationPlan, ...learningPlan]) {
        if (isPlaceholderValue(value)) {
            addIssue(result, 'error', 'placeholder-cycle-spec', 'cycle spec lists must not contain TBD/todo/placeholder values');
            break;
        }
    }
}
function hasFooterField(content, field) {
    const key = field.replace(/:$/, '');
    return new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`, 'im').test(content);
}
function readField(content, field) {
    const match = content.match(new RegExp(`^\\s*${escapeRegExp(field)}\\s*:\\s*(.*?)\\s*$`, 'im'));
    return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}
function readListOrInline(content, field) {
    const inline = readField(content, field);
    const values = [];
    if (inline && !isListIntroducer(inline)) {
        const normalized = inline.replace(/^['"]|['"]$/g, '').trim();
        if (normalized && normalized !== '[]' && normalized.toLowerCase() !== 'none')
            values.push(normalized);
    }
    const blockMatch = content.match(new RegExp(`^\\s*${escapeRegExp(field)}\\s*:\\s*\\n((?:^\\s+[-*].*\\n?)+)`, 'im'));
    if (blockMatch) {
        for (const line of blockMatch[1].split('\n')) {
            const item = line.match(/^\s*[-*]\s+(.*)$/);
            if (!item)
                continue;
            const value = item[1].trim();
            if (!value || value === '[]' || value.toLowerCase() === 'none')
                continue;
            values.push(value);
        }
    }
    return Array.from(new Set(values));
}
function isListIntroducer(value) {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === '|' || trimmed.endsWith(':');
}
function isPlaceholderValue(value) {
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0
        || normalized === '[]'
        || normalized === '-'
        || normalized === 'tbd'
        || normalized === 'todo'
        || normalized === 'pending'
        || normalized === 'placeholder'
        || normalized === '<todo>'
        || normalized === '<tbd>'
        || normalized.includes('tbd')
        || normalized.includes('todo')
        || normalized.includes('placeholder');
}
function isWeakConfidence(value) {
    if (typeof value === 'number')
        return value < 0.5;
    if (typeof value !== 'string')
        return false;
    const normalized = value.toLowerCase().trim();
    if (normalized === 'low')
        return true;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) && numeric < 0.5;
}
function countCandidateMoves(content) {
    const ids = new Set();
    const idPattern = /^\s*(?:[-*]\s*)?(?:id|move_id|candidate_id)\s*:\s*([a-z0-9][a-z0-9-]+)/gim;
    for (const match of content.matchAll(idPattern)) {
        ids.add(match[1].toLowerCase());
    }
    const tableRows = content
        .split('\n')
        .filter((line) => isCandidateTableRow(line));
    return Math.max(ids.size, tableRows.length);
}
function isCandidateTableRow(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|'))
        return false;
    if (/^\|[\s:-]+\|/.test(trimmed))
        return false;
    if (/candidate|move|lane|evidence|confidence|expected/i.test(trimmed) && /---/.test(trimmed))
        return false;
    const lower = trimmed.toLowerCase();
    const hasLane = ['product', 'ux', 'research', 'backend', 'quality', 'brand-content', 'distribution']
        .some((lane) => lower.includes(`| ${lane}`) || lower.includes(`${lane} |`));
    const hasConfidence = /\|\s*(high|medium|low)\s*\|/i.test(trimmed);
    return hasLane && hasConfidence;
}
function countKnownLanes(content) {
    const lower = content.toLowerCase();
    return [
        'product',
        'ux',
        'research',
        'backend',
        'quality',
        'brand-content',
        'distribution',
    ].filter((lane) => lower.includes(lane)).length;
}
function wordCount(content) {
    return content.trim().split(/\s+/).filter(Boolean).length;
}
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=pipeline-contract-validator.js.map
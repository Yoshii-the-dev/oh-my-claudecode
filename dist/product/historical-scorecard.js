import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { parseCycleMarkdown } from './cycle-document.js';
import { parseLearningMarkdown } from './learning-document.js';
const USER_VISIBLE_LANES = new Set(['product', 'ux', 'distribution', 'brand-content']);
const INFRA_HINTS = /\b(backend|schema|migration|api|worker|queue|infra|stack|adr|provision)\b/i;
const USER_HINTS = /\b(reader|editor|onboarding|screen|loop|content|distribution|ui|ux|activation|retention)\b/i;
export function generateHistoricalScorecard(root = process.cwd()) {
    const resolvedRoot = resolve(root);
    const artifactRoot = join(resolvedRoot, '.omc');
    const rawCycles = collectCycleDocuments(artifactRoot);
    const cycles = rawCycles
        .map((entry) => buildCycleSummary(artifactRoot, entry))
        .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
    const completed = cycles.filter((cycle) => cycle.cycle_stage === 'complete').length;
    const blocked = cycles.filter((cycle) => cycle.cycle_stage === 'blocked').length;
    const trends = buildTrends(cycles);
    const comparison = buildComparison(cycles);
    return {
        root: resolvedRoot,
        artifactRoot,
        generatedAt: new Date().toISOString(),
        cycles,
        trends,
        comparison,
        totals: {
            cycles: cycles.length,
            completed,
            blocked,
        },
    };
}
function collectCycleDocuments(artifactRoot) {
    const cyclesDir = join(artifactRoot, 'cycles');
    if (!existsSync(cyclesDir))
        return [];
    const entries = readdirSync(cyclesDir).filter((entry) => /^\d{4}-\d{2}-\d{2}/.test(entry));
    const seen = new Map();
    for (const entry of entries) {
        const filePath = join(cyclesDir, entry);
        const stat = safeStat(filePath);
        if (!stat || !stat.isFile())
            continue;
        const fileMtime = Number(stat.mtimeMs);
        if (entry.endsWith('.json')) {
            const document = parseJsonDocument(filePath);
            if (!document)
                continue;
            seen.set(document.cycle_id, { document, source: 'json', sourcePath: filePath, fileMtime });
        }
        else if (entry.endsWith('.md')) {
            const content = safeRead(filePath);
            if (!content)
                continue;
            const document = parseCycleMarkdown(content);
            if (!seen.has(document.cycle_id) || seen.get(document.cycle_id)?.source === 'markdown') {
                seen.set(document.cycle_id, { document, source: 'markdown', sourcePath: filePath, fileMtime });
            }
        }
    }
    return [...seen.values()];
}
function buildCycleSummary(artifactRoot, entry) {
    const document = entry.document;
    const stagesCompleted = countCheckedStages(document);
    const stagesTotal = Object.keys(document.stage_checklist ?? {}).length || 7;
    const startDate = inferStartDate(document, entry);
    const completedDate = inferCompletedDate(document, entry);
    const learning = readMatchingLearning(artifactRoot, document.cycle_id);
    const { userVisible, infrastructure } = scoreWorkLanes(document);
    return {
        cycle_id: document.cycle_id,
        source: entry.source,
        source_path: entry.sourcePath,
        cycle_stage: document.cycle_stage,
        product_stage: document.product_stage,
        build_route: document.spec?.build_route ?? 'unknown',
        status: document.footer?.status ?? 'unknown',
        confidence: document.footer?.confidence ?? 'unknown',
        start_date: startDate,
        completed_date: completedDate,
        time_to_complete_days: timeToCompleteDays(startDate, completedDate),
        stages_completed: stagesCompleted,
        stages_total: stagesTotal,
        user_visible_count: userVisible,
        infrastructure_count: infrastructure,
        user_visible_ratio: userVisible + infrastructure === 0 ? null : userVisible / (userVisible + infrastructure),
        evidence_count: document.footer?.evidence?.length ?? 0,
        has_learning_capture: Boolean(learning),
        learning_recommended_next_cycle: learning?.recommended_next_cycle,
    };
}
function readMatchingLearning(artifactRoot, cycleId) {
    const dir = join(artifactRoot, 'learning');
    if (!existsSync(dir))
        return undefined;
    const candidates = readdirSync(dir).filter((entry) => entry.startsWith(cycleId) || entry.includes(cycleId));
    for (const candidate of candidates) {
        const path = join(dir, candidate);
        const stat = safeStat(path);
        if (!stat?.isFile())
            continue;
        if (candidate.endsWith('.json')) {
            const json = parseJsonDocument(path);
            if (json)
                return json;
        }
        else if (candidate.endsWith('.md')) {
            const content = safeRead(path);
            if (content)
                return parseLearningMarkdown(content);
        }
    }
    return undefined;
}
function countCheckedStages(document) {
    if (!document.stage_checklist)
        return 0;
    return Object.values(document.stage_checklist).filter(Boolean).length;
}
function inferStartDate(document, entry) {
    const idMatch = document.cycle_id.match(/^(\d{4}-\d{2}-\d{2})/);
    if (idMatch)
        return idMatch[1];
    const fileNameMatch = entry.sourcePath.match(/(\d{4}-\d{2}-\d{2})/);
    if (fileNameMatch)
        return fileNameMatch[1];
    const earliest = document.history?.[0]?.at;
    return earliest ? earliest.slice(0, 10) : undefined;
}
function inferCompletedDate(document, entry) {
    const completeEvent = [...(document.history ?? [])].reverse().find((event) => event.stage === 'complete' || event.stage === 'learn');
    if (completeEvent)
        return completeEvent.at.slice(0, 10);
    if (document.cycle_stage === 'complete') {
        return document.updated_at?.slice(0, 10) ?? new Date(entry.fileMtime).toISOString().slice(0, 10);
    }
    return undefined;
}
function timeToCompleteDays(start, end) {
    if (!start || !end)
        return null;
    const ms = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(ms) || ms < 0)
        return null;
    return Math.round(ms / 86_400_000);
}
function scoreWorkLanes(document) {
    const slices = [
        document.selected_portfolio?.core_product_slice ?? '',
        document.selected_portfolio?.enabling_task ?? '',
        document.selected_portfolio?.learning_task ?? '',
    ];
    let userVisible = 0;
    let infrastructure = 0;
    for (const text of slices.filter(Boolean)) {
        if (USER_HINTS.test(text))
            userVisible += 1;
        if (INFRA_HINTS.test(text))
            infrastructure += 1;
    }
    if (document.spec?.build_route === 'product-pipeline')
        userVisible += 1;
    if (document.spec?.build_route === 'backend-pipeline')
        infrastructure += 1;
    if (document.spec?.build_route === 'both') {
        userVisible += 1;
        infrastructure += 1;
    }
    // Derive a small structural bonus from selected lane semantics in the slices.
    for (const lane of USER_VISIBLE_LANES) {
        if (slices.some((slice) => slice.toLowerCase().includes(lane))) {
            userVisible += 1;
            break;
        }
    }
    return { userVisible, infrastructure };
}
function buildTrends(cycles) {
    return [
        buildTrend('confidence', cycles, (cycle) => toNumber(cycle.confidence), 'higher-better'),
        buildTrend('user_visible_ratio', cycles, (cycle) => cycle.user_visible_ratio, 'higher-better'),
        buildTrend('time_to_complete_days', cycles, (cycle) => cycle.time_to_complete_days, 'lower-better'),
        buildTrend('evidence_count', cycles, (cycle) => cycle.evidence_count, 'higher-better'),
        buildTrend('stages_completed', cycles, (cycle) => cycle.stages_completed, 'higher-better'),
    ];
}
function buildTrend(metric, cycles, selector, direction) {
    const values = cycles.map((cycle) => ({ cycleId: cycle.cycle_id, value: selector(cycle) }));
    const numeric = values.filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value));
    if (numeric.length < 2) {
        return { metric, values, direction: 'unknown', delta: null };
    }
    const previous = numeric[numeric.length - 2].value;
    const latest = numeric[numeric.length - 1].value;
    const delta = latest - previous;
    if (delta === 0) {
        return { metric, values, direction: 'flat', delta };
    }
    if (direction === 'higher-better') {
        return { metric, values, direction: delta > 0 ? 'improving' : 'regressing', delta };
    }
    return { metric, values, direction: delta < 0 ? 'improving' : 'regressing', delta };
}
function buildComparison(cycles) {
    if (cycles.length === 0) {
        return { improvements: [], regressions: [] };
    }
    if (cycles.length === 1) {
        return { latest: cycles[0], improvements: [], regressions: [] };
    }
    const latest = cycles[cycles.length - 1];
    const previous = cycles[cycles.length - 2];
    const improvements = [];
    const regressions = [];
    if (typeof latest.user_visible_ratio === 'number' && typeof previous.user_visible_ratio === 'number') {
        if (latest.user_visible_ratio > previous.user_visible_ratio) {
            improvements.push(`user_visible_ratio rose ${formatRatio(previous.user_visible_ratio)} -> ${formatRatio(latest.user_visible_ratio)}`);
        }
        else if (latest.user_visible_ratio < previous.user_visible_ratio) {
            regressions.push(`user_visible_ratio fell ${formatRatio(previous.user_visible_ratio)} -> ${formatRatio(latest.user_visible_ratio)}`);
        }
    }
    if (typeof latest.time_to_complete_days === 'number' && typeof previous.time_to_complete_days === 'number') {
        if (latest.time_to_complete_days < previous.time_to_complete_days) {
            improvements.push(`time_to_complete fell ${previous.time_to_complete_days}d -> ${latest.time_to_complete_days}d`);
        }
        else if (latest.time_to_complete_days > previous.time_to_complete_days) {
            regressions.push(`time_to_complete rose ${previous.time_to_complete_days}d -> ${latest.time_to_complete_days}d`);
        }
    }
    const latestConfidence = toNumber(latest.confidence);
    const previousConfidence = toNumber(previous.confidence);
    if (latestConfidence !== null && previousConfidence !== null) {
        if (latestConfidence > previousConfidence) {
            improvements.push(`confidence rose ${previousConfidence.toFixed(2)} -> ${latestConfidence.toFixed(2)}`);
        }
        else if (latestConfidence < previousConfidence) {
            regressions.push(`confidence fell ${previousConfidence.toFixed(2)} -> ${latestConfidence.toFixed(2)}`);
        }
    }
    if (latest.has_learning_capture && !previous.has_learning_capture) {
        improvements.push('learning capture started landing for the cycle');
    }
    else if (!latest.has_learning_capture && previous.has_learning_capture) {
        regressions.push('learning capture missing for latest cycle');
    }
    return { latest, previous, improvements, regressions };
}
function formatRatio(value) {
    return `${(value * 100).toFixed(0)}%`;
}
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string')
        return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function safeStat(path) {
    try {
        return statSync(path);
    }
    catch {
        return undefined;
    }
}
function safeRead(path) {
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return undefined;
    }
}
function parseJsonDocument(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=historical-scorecard.js.map
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { atomicWriteJsonSync } from '../lib/atomic-write.js';
export const PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH = '.omc/product/capability-graph/current.json';
export const PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH = '.omc/product/capability-graph/current.md';
const GRAPH_STOP_WORDS = new Set([
    'with',
    'from',
    'that',
    'this',
    'into',
    'user',
    'users',
    'cycle',
    'feature',
    'capability',
    'product',
    'first',
    'loop',
    'able',
    'without',
    'current',
    'state',
]);
export function buildProductCapabilityGraphSnapshot(capabilities) {
    const nodes = new Map();
    const edges = [];
    for (const capability of capabilities) {
        nodes.set(capability.id, {
            id: capability.id,
            kind: 'capability',
            label: capability.title,
            source: capability.source_path,
            maturity: capability.maturity,
            user_job: capability.user_job,
            missing_depth_count: capability.missing_depth.length,
        });
        for (const connection of capability.connections) {
            const target = nodeForConnection(connection);
            nodes.set(target.id, target);
            edges.push({
                from: capability.id,
                to: target.id,
                type: edgeTypeForConnection(connection),
                label: target.label,
                strength: strengthForConnection(connection),
                evidence: capability.evidence,
            });
        }
        for (const depth of capability.missing_depth.filter((entry) => entry.startsWith('v1:') || entry.startsWith('v2:'))) {
            const level = depth.slice(0, 2);
            const nodeId = `maturity:${capability.id}:${level}`;
            nodes.set(nodeId, {
                id: nodeId,
                kind: 'maturity',
                label: depth,
                source: capability.source_path,
            });
            edges.push({
                from: capability.id,
                to: nodeId,
                type: 'maturity-depth',
                label: `missing ${level}`,
                strength: 0.35,
                evidence: capability.evidence,
            });
        }
    }
    for (let index = 0; index < capabilities.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < capabilities.length; otherIndex += 1) {
            const left = capabilities[index];
            const right = capabilities[otherIndex];
            if (!left || !right)
                continue;
            const shared = sharedKeywords(left, right);
            if (shared.length < 2)
                continue;
            edges.push({
                from: left.id,
                to: right.id,
                type: shared.some((token) => graphKeywords(left.user_job ?? '').includes(token) || graphKeywords(right.user_job ?? '').includes(token))
                    ? 'shared-job'
                    : 'shared-depth',
                label: `shared: ${shared.slice(0, 4).join(', ')}`,
                strength: Math.min(1, 0.35 + shared.length * 0.12),
                evidence: Array.from(new Set([...left.evidence, ...right.evidence])).filter(Boolean),
            });
        }
    }
    const capabilityDegrees = new Map(capabilities.map((capability) => [capability.id, 0]));
    const capabilityPeerDegrees = new Map(capabilities.map((capability) => [capability.id, 0]));
    for (const edge of edges) {
        const connectsCapabilities = capabilityDegrees.has(edge.from) && capabilityDegrees.has(edge.to);
        if (connectsCapabilities) {
            capabilityPeerDegrees.set(edge.from, (capabilityPeerDegrees.get(edge.from) ?? 0) + 1);
            capabilityPeerDegrees.set(edge.to, (capabilityPeerDegrees.get(edge.to) ?? 0) + 1);
        }
        if (edge.type === 'maturity-depth')
            continue;
        if (capabilityDegrees.has(edge.from))
            capabilityDegrees.set(edge.from, (capabilityDegrees.get(edge.from) ?? 0) + 1);
        if (capabilityDegrees.has(edge.to))
            capabilityDegrees.set(edge.to, (capabilityDegrees.get(edge.to) ?? 0) + 1);
    }
    const orphanCapabilities = capabilities
        .map((capability) => orphanForCapability(capability, capabilityPeerDegrees.get(capability.id) ?? 0, capabilities.length))
        .filter((orphan) => orphan !== undefined);
    for (const orphan of orphanCapabilities) {
        const node = nodes.get(orphan.capability_id);
        if (node)
            node.orphan_score = orphan.score;
    }
    const capabilityEdgeCount = edges.filter((edge) => (capabilityDegrees.has(edge.from) && capabilityDegrees.has(edge.to))).length;
    const averageCapabilityDegree = average([...capabilityDegrees.values()]);
    return {
        aggregates: {
            capability_count: capabilities.length,
            context_node_count: [...nodes.values()].filter((node) => node.kind !== 'capability').length,
            edge_count: edges.length,
            capability_edge_count: capabilityEdgeCount,
            orphan_count: orphanCapabilities.length,
            isolated_capability_count: [...capabilityDegrees.values()].filter((degree) => degree === 0).length,
            average_capability_degree: Math.round(averageCapabilityDegree * 100) / 100,
            missing_depth_count: capabilities.reduce((sum, capability) => sum + capability.missing_depth.length, 0),
        },
        nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
        edges: dedupeEdges(edges).sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`)),
        orphan_capabilities: orphanCapabilities,
    };
}
export function writeProductCapabilityGraphAudit(root, snapshot, metadata) {
    const resolvedRoot = resolve(root);
    const report = {
        schema_version: 1,
        generated_at: metadata.generatedAt,
        root: resolvedRoot,
        source_totality: metadata.sourceTotality,
        source_artifacts: metadata.sourceArtifacts,
        ...snapshot,
    };
    const jsonPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH);
    const mdPath = resolve(resolvedRoot, PRODUCT_CAPABILITY_GRAPH_MD_RELATIVE_PATH);
    mkdirSync(dirname(jsonPath), { recursive: true });
    atomicWriteJsonSync(jsonPath, report);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderProductCapabilityGraph(report), 'utf-8');
    return { jsonPath, mdPath };
}
export function renderProductCapabilityGraph(report) {
    const header = 'schema_version' in report
        ? [
            '# Product Capability Graph',
            '',
            `generated_at: ${report.generated_at}`,
            `schema_source: ${PRODUCT_CAPABILITY_GRAPH_JSON_RELATIVE_PATH}`,
            `source_totality: ${report.source_totality}`,
            '',
        ]
        : ['# Product Capability Graph', ''];
    const nodeRows = report.nodes.map((node) => (`| ${escapeCell(node.id)} | ${node.kind} | ${escapeCell(node.label)} | ${node.maturity ?? ''} | ${node.orphan_score?.toFixed(2) ?? ''} |`));
    const edgeRows = report.edges.map((edge) => (`| ${escapeCell(edge.from)} | ${escapeCell(edge.to)} | ${edge.type} | ${edge.strength.toFixed(2)} | ${escapeCell(edge.label)} |`));
    const orphanRows = report.orphan_capabilities.map((orphan) => (`| ${escapeCell(orphan.capability_id)} | ${orphan.severity} | ${orphan.score.toFixed(2)} | ${escapeCell(orphan.reasons.join('; '))} | ${escapeCell(orphan.recommended_action)} |`));
    return [
        ...header,
        '## Aggregates',
        `- capability_count: ${report.aggregates.capability_count}`,
        `- context_node_count: ${report.aggregates.context_node_count}`,
        `- edge_count: ${report.aggregates.edge_count}`,
        `- capability_edge_count: ${report.aggregates.capability_edge_count}`,
        `- orphan_count: ${report.aggregates.orphan_count}`,
        `- isolated_capability_count: ${report.aggregates.isolated_capability_count}`,
        `- average_capability_degree: ${report.aggregates.average_capability_degree.toFixed(2)}`,
        `- missing_depth_count: ${report.aggregates.missing_depth_count}`,
        '',
        '## Nodes',
        '| ID | Kind | Label | Maturity | Orphan Score |',
        '| --- | --- | --- | --- | ---: |',
        ...(nodeRows.length > 0 ? nodeRows : ['| none | capability | No capability nodes yet |  |  |']),
        '',
        '## Edges',
        '| From | To | Type | Strength | Label |',
        '| --- | --- | --- | ---: | --- |',
        ...(edgeRows.length > 0 ? edgeRows : ['| none | none | context | 0.00 | No edges yet |']),
        '',
        '## Orphan Capabilities',
        '| Capability | Severity | Score | Reasons | Recommended Action |',
        '| --- | --- | ---: | --- | --- |',
        ...(orphanRows.length > 0 ? orphanRows : ['| none | warning | 0.00 | No orphan capabilities detected | No action |']),
        '',
    ].join('\n');
}
function nodeForConnection(connection) {
    if (connection.startsWith('learning:')) {
        const source = connection.replace(/^learning:/, '');
        return { id: connection, kind: 'artifact', label: source, source };
    }
    if (connection.startsWith('portfolio:')) {
        return { id: connection, kind: 'portfolio', label: connection.replace(/^portfolio:/, '') };
    }
    return { id: `context:${connection}`, kind: 'context', label: connection };
}
function edgeTypeForConnection(connection) {
    if (connection.startsWith('learning:'))
        return 'learning';
    if (connection.startsWith('portfolio:'))
        return 'portfolio';
    return 'context';
}
function strengthForConnection(connection) {
    if (connection.startsWith('learning:'))
        return 0.9;
    if (connection.startsWith('portfolio:'))
        return 0.8;
    if (connection === 'roadmap' || connection === 'ecosystem')
        return 0.75;
    if (connection === 'meaning')
        return 0.65;
    if (connection === 'visual-expectation' || connection === 'taste-gate')
        return 0.6;
    return 0.5;
}
function orphanForCapability(capability, peerDegree, capabilityCount) {
    const reasons = [];
    const hasLearning = capability.connections.some((connection) => connection.startsWith('learning:'));
    const hasPortfolio = capability.connections.some((connection) => connection.startsWith('portfolio:'));
    const hasSystemContext = capability.connections.some((connection) => (connection === 'roadmap' || connection === 'ecosystem' || connection === 'meaning'));
    const structuralConnections = [hasLearning, hasPortfolio, hasSystemContext].filter(Boolean).length;
    if (!hasLearning)
        reasons.push('no learning capture edge');
    if (!hasPortfolio)
        reasons.push('no portfolio/work-item edge');
    if (!hasSystemContext)
        reasons.push('no roadmap/ecosystem/meaning edge');
    if (capabilityCount > 1 && peerDegree === 0) {
        reasons.push('does not reinforce another completed capability');
    }
    if (capability.maturity === 'missing-expectation')
        reasons.push('missing expectation contract');
    if (capability.maturity === 'seeded-v0')
        reasons.push('still only a v0 seed');
    if (capability.missing_depth.length > 0)
        reasons.push('missing maturity depth remains');
    const score = clamp((structuralConnections < 2 ? 0.35 : 0)
        + (!hasLearning ? 0.2 : 0)
        + (!hasPortfolio ? 0.15 : 0)
        + (!hasSystemContext ? 0.15 : 0)
        + (capability.maturity === 'missing-expectation' ? 0.25 : 0)
        + (capability.maturity === 'seeded-v0' ? 0.15 : 0)
        + (capability.missing_depth.length > 0 ? 0.1 : 0));
    if (score < 0.4)
        return undefined;
    return {
        capability_id: capability.id,
        title: capability.title,
        severity: score >= 0.75 || capability.maturity === 'missing-expectation' ? 'error' : 'warning',
        score: Math.round(score * 100) / 100,
        reasons,
        recommended_action: `Reconnect ${capability.title} to a real user loop, portfolio depth move, learning capture, and adjacent product system before treating it as done.`,
        evidence: capability.evidence,
    };
}
function sharedKeywords(left, right) {
    const leftKeywords = new Set(graphKeywords([
        left.title,
        left.user_job ?? '',
        left.first_meaningful_use ?? '',
        left.missing_depth.join(' '),
    ].join(' ')));
    return graphKeywords([
        right.title,
        right.user_job ?? '',
        right.first_meaningful_use ?? '',
        right.missing_depth.join(' '),
    ].join(' ')).filter((token) => leftKeywords.has(token));
}
function graphKeywords(value) {
    return Array.from(new Set(value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 3 && !GRAPH_STOP_WORDS.has(token))))
        .slice(0, 16);
}
function dedupeEdges(edges) {
    const seen = new Set();
    const out = [];
    for (const edge of edges) {
        const key = `${edge.from}:${edge.to}:${edge.type}:${edge.label}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(edge);
    }
    return out;
}
function average(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function clamp(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function escapeCell(value) {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
//# sourceMappingURL=capability-graph.js.map
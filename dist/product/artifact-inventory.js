import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { PRODUCT_ARTIFACT_ALLOWED_DIRECTORIES, PRODUCT_ARTIFACT_CURRENT_PATHS, PRODUCT_ARTIFACT_REGISTRY, PRODUCT_STANDARD_FOOTER_FIELDS, getProductArtifactRegistryEntries, } from './pipeline-registry.js';
const MAX_PRODUCT_ARTIFACT_FILES = 800;
const STALE_PRESSURE_THRESHOLD = 12;
export function validateProductArtifactInventory(root = process.cwd()) {
    const resolvedRoot = resolve(root);
    const artifactRoot = resolve(resolvedRoot, '.omc');
    const issues = [];
    if (!existsSync(artifactRoot)) {
        return makeReport(resolvedRoot, artifactRoot, 0, issues);
    }
    const files = collectArtifactFiles(artifactRoot, resolvedRoot).slice(0, MAX_PRODUCT_ARTIFACT_FILES);
    const productFiles = files.filter((file) => isProductArtifactPath(file.relativePath));
    for (const entry of getProductArtifactRegistryEntries()) {
        const path = resolve(resolvedRoot, entry.currentPath);
        if (existsSync(path))
            continue;
        if (entry.machineContract === 'strict') {
            issues.push(issue('warning', 'missing-current-artifact', entry.currentPath, `Missing registered current artifact owned by ${entry.owner}`));
        }
    }
    for (const file of productFiles) {
        if (isUnregisteredCurrentArtifact(file.relativePath)) {
            issues.push(issue('warning', 'unregistered-current-artifact', file.relativePath, 'Current artifact is not in PRODUCT_ARTIFACT_REGISTRY; add it to the registry or archive it'));
        }
        if (file.relativePath.endsWith('.md') && shouldRequireFooter(file.relativePath) && !hasStandardFooter(file.content)) {
            issues.push(issue('warning', 'markdown-missing-contract-footer', file.relativePath, `Markdown product artifact is missing standard footer fields: ${PRODUCT_STANDARD_FOOTER_FIELDS.join(', ')}`));
        }
        if (file.relativePath.endsWith('.json') && PRODUCT_ARTIFACT_CURRENT_PATHS.has(file.relativePath) && !isValidJson(file.content)) {
            issues.push(issue('error', 'invalid-json-artifact', file.relativePath, 'Registered JSON artifact is not valid JSON'));
        }
    }
    for (const [dir, count] of countByDirectory(productFiles).entries()) {
        if (count > STALE_PRESSURE_THRESHOLD) {
            issues.push(issue('warning', 'stale-artifact-pressure', dir, `${count} artifacts in one product directory; run artifact lifecycle/archive before downstream agents broad-scan this context`));
        }
    }
    return makeReport(resolvedRoot, artifactRoot, productFiles.length, issues);
}
function collectArtifactFiles(dir, root) {
    const out = [];
    walk(dir, root, out);
    return out;
}
function walk(dir, root, out) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            if (entry === 'logs' || entry === 'state' || entry === 'archive')
                continue;
            walk(path, root, out);
            continue;
        }
        if (!stat.isFile() || !/\.(md|json|jsonc)$/i.test(path))
            continue;
        const relativePath = relative(root, path);
        out.push({ path, relativePath, content: safeRead(path) });
    }
}
function isProductArtifactPath(relativePath) {
    return PRODUCT_ARTIFACT_ALLOWED_DIRECTORIES.some((prefix) => relativePath.startsWith(prefix));
}
function isUnregisteredCurrentArtifact(relativePath) {
    return /\/current\.(md|json|jsonc)$/i.test(relativePath)
        && !PRODUCT_ARTIFACT_CURRENT_PATHS.has(relativePath);
}
function shouldRequireFooter(relativePath) {
    if (relativePath.endsWith('/current.md'))
        return true;
    if (relativePath === '.omc/constitution.md')
        return true;
    if (relativePath.includes('/handoffs/'))
        return true;
    if (relativePath.includes('/audits/'))
        return true;
    return /\b20\d{2}-\d{2}-\d{2}\b/.test(relativePath);
}
function hasStandardFooter(content) {
    return PRODUCT_STANDARD_FOOTER_FIELDS.every((field) => content.includes(field));
}
function isValidJson(content) {
    try {
        JSON.parse(content);
        return true;
    }
    catch {
        return false;
    }
}
function countByDirectory(files) {
    const counts = new Map();
    for (const file of files) {
        const dir = file.relativePath.replace(/\/[^/]+$/, '/');
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
    return counts;
}
function safeRead(path) {
    try {
        return readFileSync(path, 'utf-8');
    }
    catch {
        return '';
    }
}
function makeReport(root, artifactRoot, filesScanned, issues) {
    const errors = issues.filter((entry) => entry.severity === 'error').length;
    const warnings = issues.length - errors;
    return {
        ok: errors === 0,
        root,
        artifactRoot,
        filesScanned,
        registeredCurrentArtifacts: Object.values(PRODUCT_ARTIFACT_REGISTRY)
            .filter((entry) => existsSync(resolve(root, entry.currentPath))).length,
        issues,
        summary: {
            errors,
            warnings,
            registeredArtifacts: getProductArtifactRegistryEntries().length,
            unregisteredCurrentArtifacts: issues.filter((entry) => entry.code === 'unregistered-current-artifact').length,
            markdownWithoutFooter: issues.filter((entry) => entry.code === 'markdown-missing-contract-footer').length,
            stalePressureDirectories: issues.filter((entry) => entry.code === 'stale-artifact-pressure').length,
        },
    };
}
function issue(severity, code, path, message) {
    return { severity, code, path, message };
}
//# sourceMappingURL=artifact-inventory.js.map
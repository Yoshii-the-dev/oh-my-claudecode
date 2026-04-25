import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductArtifactInventory } from '../artifact-inventory.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('product artifact inventory', () => {
  it('passes an empty .omc inventory', () => {
    const root = createRoot();

    const report = validateProductArtifactInventory(root);

    expect(report.ok).toBe(true);
    expect(report.filesScanned).toBe(0);
  });

  it('flags unregistered current artifacts and markdown without contract footer', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/research/current.md', '# Research\n');
    writeArtifact(root, '.omc/opportunities/current.md', '# Opportunities\n');

    const report = validateProductArtifactInventory(root);

    expect(report.ok).toBe(true);
    expect(report.summary.unregisteredCurrentArtifacts).toBe(1);
    expect(report.summary.markdownWithoutFooter).toBe(2);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'unregistered-current-artifact',
      'markdown-missing-contract-footer',
    ]));
  });

  it('treats invalid registered JSON as an error', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/portfolio/current.json', '{invalid');

    const report = validateProductArtifactInventory(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('invalid-json-artifact');
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-artifact-inventory-'));
  rootsToClean.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

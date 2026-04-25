#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputPath = join(root, 'docs', 'generated', 'product-pipeline-registry.md');

const { renderProductPipelineRegistryMarkdown } = await import('../dist/product/pipeline-registry.js');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, renderProductPipelineRegistryMarkdown(), 'utf-8');
console.log(`Generated ${outputPath}`);

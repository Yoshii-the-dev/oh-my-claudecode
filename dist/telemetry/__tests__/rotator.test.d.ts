/**
 * rotator.test.ts
 *
 * Covers:
 * - Size-based rotation (>= 8 MB → archive + truncate)
 * - Time-based rotation (file mtime > 24 h → rotate, mocked via fs.utimesSync)
 * - No rotation when file is small and recent
 * - Archive is .jsonl.gz and content is valid gzip
 * - gcArchives removes archives older than 30 days
 * - gcArchives leaves recent archives intact
 */
export {};
//# sourceMappingURL=rotator.test.d.ts.map
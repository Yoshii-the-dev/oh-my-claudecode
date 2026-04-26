/**
 * Project Environment Detector
 * Auto-detects languages, frameworks, build tools, and conventions
 */
import { ProjectMemory, ProjectFingerprint } from './types.js';
/**
 * Main entry point: detect all project environment details
 */
export declare function detectProjectEnvironment(projectRoot: string): Promise<ProjectMemory>;
/**
 * Build a compact fingerprint from files/directories that define the current
 * project incarnation. This prevents learned notes from an old project in the
 * same path from being treated as current truth after a reset.
 */
export declare function computeProjectFingerprint(projectRoot: string): Promise<ProjectFingerprint>;
//# sourceMappingURL=detector.d.ts.map
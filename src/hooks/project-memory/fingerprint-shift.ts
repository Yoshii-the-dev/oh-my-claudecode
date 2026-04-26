/**
 * Project Fingerprint Shift Detection
 *
 * When a project's marker files (package.json, tsconfig, lockfiles, top-level
 * dirs) change between sessions, learned data in `.omc/project-memory.json`
 * is dropped (see detector.ts + index.ts). This module covers the *other*
 * `.omc/**` knowledge artefacts (constitution, competitors, portfolio, specs,
 * etc.) that downstream agents may otherwise treat as factual baseline.
 *
 * Strategy is deliberately conservative: we do not modify those artefacts. We
 * scan which exist, emit a critical-priority `<system-reminder>` warning into
 * the session context, and log the shift to `.omc/.fingerprint-history.json`
 * for audit.
 */

import fs from "fs/promises";
import path from "path";
import { atomicWriteJson } from "../../lib/atomic-write.js";

/**
 * Top-level `.omc/<dir>/` paths that typically hold "old knowledge" — i.e.
 * artefacts an agent might cite as factual when they actually describe a
 * previous incarnation of the project.
 *
 * Runtime/transient dirs (state, sessions, logs) are intentionally excluded.
 */
const KNOWLEDGE_DIRS = [
  "specs",
  "ideas",
  "competitors",
  "research",
  "brand",
  "meaning",
  "portfolio",
  "opportunities",
  "roadmap",
  "decisions",
  "handoffs",
  "audits",
  "strategy",
  "product",
  "ecosystem",
  "provisioned",
  "experience",
  "plans",
  "reset",
];

const KNOWLEDGE_FILES = ["constitution.md", "notepad.md"];

const HISTORY_FILE = ".fingerprint-history.json";
const HISTORY_LIMIT = 10;

export interface FingerprintShiftEntry {
  previousHash: string | null;
  currentHash: string;
  recordedAt: number;
  staleArtefacts: string[];
}

export interface StaleOmcReport {
  files: string[];
  directories: string[];
  totalCount: number;
}

export async function scanStaleOmcArtefacts(
  projectRoot: string,
): Promise<StaleOmcReport> {
  const omcRoot = path.join(projectRoot, ".omc");
  const files: string[] = [];
  const directories: string[] = [];

  for (const file of KNOWLEDGE_FILES) {
    if (await pathExists(path.join(omcRoot, file))) {
      files.push(`.omc/${file}`);
    }
  }

  for (const dir of KNOWLEDGE_DIRS) {
    if (await pathExists(path.join(omcRoot, dir))) {
      directories.push(`.omc/${dir}/`);
    }
  }

  return {
    files,
    directories,
    totalCount: files.length + directories.length,
  };
}

export function formatFingerprintShiftWarning(
  report: StaleOmcReport,
  previousHashShort: string,
  currentHashShort: string,
): string {
  const lines: string[] = [];
  lines.push("<system-reminder>");
  lines.push("[Project Fingerprint Shift Detected]");
  lines.push(
    "Project marker files (package.json, tsconfig, lockfiles, top-level dirs) changed since project memory was last validated.",
  );
  lines.push(
    `Previous fingerprint: ${previousHashShort} | Current fingerprint: ${currentHashShort}.`,
  );

  if (report.totalCount > 0) {
    lines.push("");
    lines.push(
      "Treat the following `.omc/**` artefacts as POTENTIALLY STALE — they may describe a previous incarnation of this project. Verify against current source files before citing as factual baseline:",
    );
    for (const file of report.files) {
      lines.push(`- ${file}`);
    }
    for (const dir of report.directories) {
      lines.push(`- ${dir}`);
    }
    lines.push("");
    lines.push(
      "Do not infer implemented features, current phase, selected stack, or roadmap status from these artefacts without matching current filesystem evidence. If in doubt, ask the user whether to keep, archive, or rewrite them.",
    );
  } else {
    lines.push("");
    lines.push("No `.omc/` knowledge artefacts found — clean state.");
  }

  lines.push("</system-reminder>");
  return lines.join("\n");
}

export async function appendFingerprintHistory(
  projectRoot: string,
  entry: FingerprintShiftEntry,
): Promise<void> {
  const omcRoot = path.join(projectRoot, ".omc");
  const historyPath = path.join(omcRoot, HISTORY_FILE);

  let history: FingerprintShiftEntry[] = [];
  try {
    const content = await fs.readFile(historyPath, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      history = parsed;
    }
  } catch {
    // No history yet or unreadable — start fresh.
  }

  history.push(entry);
  if (history.length > HISTORY_LIMIT) {
    history = history.slice(-HISTORY_LIMIT);
  }

  try {
    await fs.mkdir(omcRoot, { recursive: true });
    await atomicWriteJson(historyPath, history);
  } catch (error) {
    console.error("Failed to write fingerprint history:", error);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export function shortenHash(hash: string | null | undefined): string {
  if (!hash) {
    return "(none)";
  }
  return hash.slice(0, 8);
}

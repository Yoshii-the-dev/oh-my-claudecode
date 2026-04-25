import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

export interface RunScorecardMetric {
  value: number | null;
  unit: string;
  status: 'good' | 'warn' | 'bad' | 'unknown';
  detail: string;
}

export interface RunScorecardReport {
  root: string;
  artifactRoot: string;
  generatedAt: string;
  totals: {
    artifacts: number;
    words: number;
    handoffs: number;
    decisions: number;
  };
  metrics: {
    downstreamAcceptedWithoutReworkRate: RunScorecardMetric;
    reworkRate: RunScorecardMetric;
    artifactBloatRate: RunScorecardMetric;
    timeToFirstUsableLoopDays: RunScorecardMetric;
    userVisibleToInfrastructureRatio: RunScorecardMetric;
    evidenceConfidenceCoverage: RunScorecardMetric;
    researchInsteadOfInventionRate: RunScorecardMetric;
  };
  evidence: {
    acceptedHandoffs: string[];
    reworkSignals: string[];
    bloatedArtifacts: string[];
    firstUsableLoopSignals: string[];
    userVisibleWork: string[];
    infrastructureWork: string[];
    decisionsWithEvidenceConfidence: string[];
    decisionsMissingEvidenceConfidence: string[];
    researchRoutedTasks: string[];
    inventionRiskSignals: string[];
  };
}

interface Artifact {
  path: string;
  relativePath: string;
  content: string;
  words: number;
  date?: string;
}

const ARTIFACT_WORD_BUDGET = 1800;
const MAX_ARTIFACTS = 600;

export function generateRunScorecard(root = process.cwd()): RunScorecardReport {
  const resolvedRoot = resolve(root);
  const artifactRoot = join(resolvedRoot, '.omc');
  const artifacts = readArtifacts(artifactRoot, resolvedRoot);
  const handoffs = artifacts.filter(isHandoffArtifact);
  const decisions = artifacts.filter(isDecisionArtifact);
  const acceptedHandoffs = handoffs.filter(hasAcceptedSignal).filter((artifact) => !hasReworkSignal(artifact));
  const reworkSignals = handoffs.filter(hasReworkSignal);
  const bloatedArtifacts = artifacts.filter((artifact) => artifact.words > ARTIFACT_WORD_BUDGET);
  const firstUsableLoopSignals = artifacts.filter(hasFirstUsableLoopSignal);
  const userVisibleWork = artifacts.filter(hasUserVisibleWorkSignal);
  const infrastructureWork = artifacts.filter(hasInfrastructureWorkSignal);
  const decisionsWithEvidenceConfidence = decisions.filter(hasEvidenceAndConfidence);
  const decisionsMissingEvidenceConfidence = decisions.filter((artifact) => !hasEvidenceAndConfidence(artifact));
  const researchRoutedTasks = artifacts.filter(hasResearchRoutedSignal);
  const inventionRiskSignals = artifacts.filter(hasInventionRiskSignal);

  const firstStartDate = minDate(artifacts.map((artifact) => artifact.date));
  const firstLoopDate = minDate(firstUsableLoopSignals.map((artifact) => artifact.date));

  return {
    root: resolvedRoot,
    artifactRoot,
    generatedAt: new Date().toISOString(),
    totals: {
      artifacts: artifacts.length,
      words: artifacts.reduce((sum, artifact) => sum + artifact.words, 0),
      handoffs: handoffs.length,
      decisions: decisions.length,
    },
    metrics: {
      downstreamAcceptedWithoutReworkRate: percentMetric(
        acceptedHandoffs.length,
        handoffs.length,
        'accepted handoffs without rework',
        { good: 0.8, warn: 0.6 },
      ),
      reworkRate: inversePercentMetric(
        reworkSignals.length,
        Math.max(handoffs.length, 1),
        'handoffs with rework/revise/reject signals',
        { good: 0.15, warn: 0.35 },
      ),
      artifactBloatRate: inversePercentMetric(
        bloatedArtifacts.length,
        Math.max(artifacts.length, 1),
        `artifacts over ${ARTIFACT_WORD_BUDGET} words`,
        { good: 0.1, warn: 0.25 },
      ),
      timeToFirstUsableLoopDays: timeToFirstLoopMetric(firstStartDate, firstLoopDate),
      userVisibleToInfrastructureRatio: ratioMetric(
        userVisibleWork.length,
        infrastructureWork.length,
        'user-visible work signals per infrastructure work signal',
        { good: 1.2, warn: 0.7 },
      ),
      evidenceConfidenceCoverage: percentMetric(
        decisionsWithEvidenceConfidence.length,
        decisions.length,
        'decision artifacts with both evidence and confidence',
        { good: 0.85, warn: 0.65 },
      ),
      researchInsteadOfInventionRate: percentMetric(
        researchRoutedTasks.length,
        researchRoutedTasks.length + inventionRiskSignals.length,
        'research-routed uncertainty signals vs invention-risk signals',
        { good: 0.7, warn: 0.45 },
      ),
    },
    evidence: {
      acceptedHandoffs: paths(acceptedHandoffs),
      reworkSignals: paths(reworkSignals),
      bloatedArtifacts: paths(bloatedArtifacts),
      firstUsableLoopSignals: paths(firstUsableLoopSignals),
      userVisibleWork: paths(userVisibleWork),
      infrastructureWork: paths(infrastructureWork),
      decisionsWithEvidenceConfidence: paths(decisionsWithEvidenceConfidence),
      decisionsMissingEvidenceConfidence: paths(decisionsMissingEvidenceConfidence),
      researchRoutedTasks: paths(researchRoutedTasks),
      inventionRiskSignals: paths(inventionRiskSignals),
    },
  };
}

function readArtifacts(artifactRoot: string, root: string): Artifact[] {
  if (!existsSync(artifactRoot)) return [];

  const files: string[] = [];
  collectFiles(artifactRoot, files);

  return files
    .filter((path) => /\.(md|json|jsonc)$/i.test(path))
    .slice(0, MAX_ARTIFACTS)
    .map((path) => {
      const content = safeRead(path);
      return {
        path,
        relativePath: relative(root, path),
        content,
        words: wordCount(content),
        date: extractDate(path, content),
      };
    });
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectFiles(path, out);
    } else if (stat.isFile()) {
      out.push(path);
    }
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function isHandoffArtifact(artifact: Artifact): boolean {
  const lowerPath = artifact.relativePath.toLowerCase();
  const lower = artifact.content.toLowerCase();
  return lowerPath.includes('.omc/handoffs/')
    || lower.includes('requested_next_agent:')
    || lower.includes('handoff-envelope')
    || lower.includes('handoff');
}

function isDecisionArtifact(artifact: Artifact): boolean {
  const path = artifact.relativePath.toLowerCase();
  return path.includes('.omc/decisions/')
    || path.includes('.omc/portfolio/')
    || path.includes('.omc/opportunities/')
    || path.includes('.omc/roadmap/')
    || path.includes('.omc/cycles/')
    || path.includes('.omc/product/capability-map/')
    || path.includes('.omc/strategy/');
}

function hasAcceptedSignal(artifact: Artifact): boolean {
  return /\b(accepted|approved|approve|pass|passed|ok|ready-for-build|ready-for-first-loop)\b/i.test(artifact.content);
}

function hasReworkSignal(artifact: Artifact): boolean {
  return /\b(rework|revise|revision|required changes|request changes|rejected|reject|failed|blocked|rewind)\b/i.test(artifact.content);
}

function hasFirstUsableLoopSignal(artifact: Artifact): boolean {
  return /first usable loop|usable loop|ready-for-first-loop|cycle_stage:\s*complete|shipped outcome/i.test(artifact.content);
}

function hasUserVisibleWorkSignal(artifact: Artifact): boolean {
  return /\b(user[-_ ]visible|core_product_slice|core product slice|product-pipeline|ux|ui|onboarding|reader|editor|screen|flow|activation|retention|content|distribution)\b/i.test(artifact.content);
}

function hasInfrastructureWorkSignal(artifact: Artifact): boolean {
  return /\b(infrastructure|backend|schema|package|provision|stack|adr|technology-strategist|database|migration|api|worker|queue|auth|telemetry)\b/i.test(artifact.content);
}

function hasEvidenceAndConfidence(artifact: Artifact): boolean {
  return /^\s*"?evidence"?\s*:/im.test(artifact.content) && /^\s*"?confidence"?\s*:/im.test(artifact.content);
}

function hasResearchRoutedSignal(artifact: Artifact): boolean {
  return /\b(research task|learning_task|learning\/research task|document-specialist|ux-researcher|competitor-scout|design partner|study plan|needs-research|research gate)\b/i.test(artifact.content);
}

function hasInventionRiskSignal(artifact: Artifact): boolean {
  return /\b(assume|assuming|invented|guess|no evidence|proxy-only|unknown critical|low confidence|unsupported)\b/i.test(artifact.content)
    && !hasResearchRoutedSignal(artifact);
}

function percentMetric(
  numerator: number,
  denominator: number,
  detail: string,
  thresholds: { good: number; warn: number },
): RunScorecardMetric {
  if (denominator === 0) {
    return { value: null, unit: '%', status: 'unknown', detail: `No denominator for ${detail}` };
  }
  const value = numerator / denominator;
  return {
    value,
    unit: '%',
    status: value >= thresholds.good ? 'good' : value >= thresholds.warn ? 'warn' : 'bad',
    detail: `${numerator}/${denominator} ${detail}`,
  };
}

function inversePercentMetric(
  numerator: number,
  denominator: number,
  detail: string,
  thresholds: { good: number; warn: number },
): RunScorecardMetric {
  if (denominator === 0) {
    return { value: null, unit: '%', status: 'unknown', detail: `No denominator for ${detail}` };
  }
  const value = numerator / denominator;
  return {
    value,
    unit: '%',
    status: value <= thresholds.good ? 'good' : value <= thresholds.warn ? 'warn' : 'bad',
    detail: `${numerator}/${denominator} ${detail}`,
  };
}

function ratioMetric(
  numerator: number,
  denominator: number,
  detail: string,
  thresholds: { good: number; warn: number },
): RunScorecardMetric {
  if (numerator === 0 && denominator === 0) {
    return { value: null, unit: 'ratio', status: 'unknown', detail: `No signals for ${detail}` };
  }
  const value = denominator === 0 ? numerator : numerator / denominator;
  return {
    value,
    unit: 'ratio',
    status: value >= thresholds.good ? 'good' : value >= thresholds.warn ? 'warn' : 'bad',
    detail: `${numerator}:${denominator} ${detail}`,
  };
}

function timeToFirstLoopMetric(startDate: string | undefined, loopDate: string | undefined): RunScorecardMetric {
  if (!startDate || !loopDate) {
    return {
      value: null,
      unit: 'days',
      status: 'unknown',
      detail: 'Could not infer both cycle start date and first usable loop date',
    };
  }
  const days = Math.max(0, Math.round((Date.parse(loopDate) - Date.parse(startDate)) / 86_400_000));
  return {
    value: days,
    unit: 'days',
    status: days <= 14 ? 'good' : days <= 30 ? 'warn' : 'bad',
    detail: `${startDate} -> ${loopDate}`,
  };
}

function extractDate(path: string, content: string): string | undefined {
  const combined = `${path}\n${content}`;
  const match = combined.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1];
}

function minDate(dates: Array<string | undefined>): string | undefined {
  const valid = dates.filter((date): date is string => Boolean(date)).sort();
  return valid[0];
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function paths(artifacts: Artifact[]): string[] {
  return artifacts.map((artifact) => artifact.relativePath).sort();
}

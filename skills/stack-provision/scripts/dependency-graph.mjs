/**
 * Skill dependency graph.
 *
 * Phase 3: candidates can declare `peer_skills` (other skill slugs they
 * expect to run alongside) and `requires_capabilities` (capability cells
 * the user's matrix must already cover). This module:
 *
 *   1. Builds a map slug→candidate so the orchestrator can look up peers.
 *   2. Closes the approved set transitively over `peer_skills` whose peer
 *      candidates are themselves classifiable as auto-approve.
 *   3. Detects unsatisfied `requires_capabilities` against the run's
 *      capability matrix and emits a `dependency:unsatisfied:<cap>` flag.
 *
 * The module is pure: it does not hit the network or filesystem.
 *
 * Public API:
 *   buildSkillIndex(candidates) -> Map<slug, candidate[]>
 *   resolveDependencies(approvedIds, candidatesById, options)
 *     -> { approved: string[], added: string[], blocked: Array<{id, reason}> }
 *   evaluateCapabilityRequirements(candidate, coveredCapabilities)
 *     -> { ok: boolean, missing: string[], flags: string[] }
 */

export function buildSkillIndex(candidates) {
  const index = new Map();
  if (!Array.isArray(candidates)) return index;
  for (const c of candidates) {
    if (!c?.slug) continue;
    if (!index.has(c.slug)) index.set(c.slug, []);
    index.get(c.slug).push(c);
  }
  return index;
}

function readPeers(candidate) {
  const list = candidate?.peer_skills ?? candidate?.peers ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((p) => String(p)).filter(Boolean);
}

function readRequiredCapabilities(candidate) {
  const list = candidate?.requires_capabilities ?? candidate?.required_capabilities ?? [];
  if (!Array.isArray(list)) return [];
  return list.map((p) => String(p)).filter(Boolean);
}

export function resolveDependencies(approvedIds, candidatesById, options = {}) {
  const skillIndex = options.skillIndex
    ?? buildSkillIndex([...candidatesById.values()]);
  const verdictFor = options.verdictFor ?? ((c) => c?.__verdict ?? null);
  const approved = new Set(approvedIds);
  const added = [];
  const blocked = [];

  // Iterative closure over peers — bounded by candidate count for safety.
  let changed = true;
  let iterations = 0;
  while (changed && iterations < candidatesById.size + 4) {
    changed = false;
    iterations += 1;
    for (const id of [...approved]) {
      const candidate = candidatesById.get(id);
      if (!candidate) continue;
      const peers = readPeers(candidate);
      for (const peerSlug of peers) {
        const peerCandidates = skillIndex.get(peerSlug) ?? [];
        if (peerCandidates.length === 0) {
          blocked.push({ id, reason: `peer-missing:${peerSlug}` });
          continue;
        }
        const peer = peerCandidates[0];
        if (approved.has(peer.candidate_id)) continue;
        const verdict = verdictFor(peer);
        if (verdict?.decision === 'auto-approve' || verdict?.decision === 'allow') {
          approved.add(peer.candidate_id);
          added.push(peer.candidate_id);
          changed = true;
        } else {
          blocked.push({ id, reason: `peer-not-approved:${peerSlug}:${peer.candidate_id}` });
        }
      }
    }
  }

  return {
    approved: [...approved],
    added,
    blocked,
  };
}

export function evaluateCapabilityRequirements(candidate, coveredCapabilities) {
  const required = readRequiredCapabilities(candidate);
  if (required.length === 0) return { ok: true, missing: [], flags: [] };
  const covered = new Set(
    Array.isArray(coveredCapabilities)
      ? coveredCapabilities.map((c) => String(c))
      : [],
  );
  const missing = required.filter((r) => !covered.has(r));
  if (missing.length === 0) return { ok: true, missing: [], flags: [] };
  return {
    ok: false,
    missing,
    flags: missing.map((m) => `dependency:unsatisfied:${m}`),
  };
}

---
name: ideate
description: Divergent ideation pipeline — 7-phase orchestrator running JTBD/ODI, TRIZ, SCAMPER, Blue Ocean, Morphological, Biomimicry, Lateral/PO, First Principles in parallel, then scoring, red-team, and experiment design
argument-hint: "<problem or feature description>"
level: 4
---

# Ideate Skill

Orchestrates divergent idea generation using multiple scientifically-grounded methods in parallel, then converges through clustering, multi-criteria scoring, critic red-team, and experiment design. Input is a problem or job-to-be-done; output is a shortlist of falsifiable hypotheses with experiment cards, ready for product-strategist gating and priority-engine ranking.

## Usage

```
/oh-my-claudecode:ideate "<problem description>"
/ideate "<problem description>"
```

### Examples

```
/ideate "reduce time-to-first-value for new users in our onboarding"
/ideate "our sync engine is too slow when a workspace has >1000 documents"
/ideate "find ways to differentiate against <competitor> in the enterprise tier"
/ideate "what should a project-memory layer look like if we started from scratch?"
```

### Flags

- `--methods=<list>` — override auto-selection: `--methods=jtbd-odi,triz,blue-ocean`
- `--skip-redteam` — produce shortlist without critic pass (not recommended; use only for early brainstorming)
- `--n-ideas=<int>` — minimum raw ideas per method (default 5)
- `--competitors=<list>` — focus Blue Ocean specifically on named competitors; read matching dossiers only through `.omc/competitors/index.md` pointers or explicit paths
- `--track=<backend|frontend|both>` — routing hint for downstream pipelines

<Purpose>
One command that converts a problem statement into a scored shortlist of hypotheses. Runs non-skippable context-loading, parallel multi-method divergence, clustering, scoring with per-dimension confidence, mandatory red-team via critic, and experiment design. Stops at HARD STOPs (missing constitution with no override, zero viable ideas from any method, or critic rejection of the entire shortlist) and reports the reason plus remediation path.
</Purpose>

<Use_When>
- User describes a problem without a predetermined solution ("how could we...", "what if...", "we need to figure out...").
- A feature request is vague and would fail product-strategist's `NEEDS CLARIFICATION` gate — ideate first, then product-pipeline.
- Strategic re-exploration is needed (quarterly planning, competitor move, market shift).
- `oh-my-claudecode:priority-engine` returns no strong candidates — the backlog needs divergent refresh.
- User explicitly invokes `/ideate`.
</Use_When>

<Do_Not_Use_When>
- The solution is already chosen and only needs planning — use planner / ralplan directly.
- Bug fixes with a known repro — use debugger / executor.
- Refactors with no product impact — use architect → executor.
- Implementation has already passed product-strategist and is in scope — use product-pipeline.
- Purely analytical questions about existing code — use explore / architect.
</Do_Not_Use_When>

<Why_This_Exists>
OMC's product-pipeline is a **convergent** pipeline: it evaluates and refines a feature that is handed to it. It does not generate candidate features. The `oh-my-claudecode:ideate` hand-off referenced by product-strategist was previously unimplemented — this skill closes that gap.

Without a structured divergent layer, teams default to the first idea that feels reasonable and miss the long tail where novel, high-reward ideas live. Single-method ideation produces a predictable distribution (SCAMPER → variations, JTBD → outcome-gaps, TRIZ → contradiction resolutions). Running multiple independent methods in parallel and flagging ideas that converge across unrelated methods is the cheapest way to surface robust, high-variance candidates.

Single-pass LLM "brainstorm" outputs are creativity theater. This skill enforces: structured input contract, method provenance per idea, score vectors with confidence markers, mandatory red-team, falsifiable hypotheses, and experiment cards. The output is not "a list of ideas" — it is a decision-ready artifact.
</Why_This_Exists>

<Pipeline_Phases>

## Phase 0 — Foundation Check

**Agent:** brand-steward (invoked only if constitution is absent/draft AND no prior interaction this session)
**Input:** `.omc/constitution.md`
**Output:** Confirmation of constitution status; handoff to Phase 1.

**Protocol:**
1. Read `.omc/constitution.md`.
2. If absent or `status: draft` AND brand-steward has not been run this session → recommend running `/oh-my-claudecode:brand-steward` first. If the user declines or `OMC_SKIP_HOOKS` is set, proceed with every output tagged UNVALIDATED-AGAINST-CONSTITUTION.
3. If `status: partial` → warn: "Constitution is partial — anti-goal gates will have gaps. Proceeding." Continue.
4. If `status: complete` → proceed silently.

**HARD STOP:** None by default. Without override flag `--no-constitution`, the skill warns but does not block — a deliberate choice because exploratory ideation is useful even with a draft constitution; the anti-goal gate at product-strategist is the real filter downstream.

---

## Phase 1 — Context Ingestion

**Agent:** ideate (single invocation; no parallelism)
**Input:** Problem description + `.omc/constitution.md` + compact research/competitor/strategy artifacts:
- `.omc/digests/research-highlights.md` or `.omc/research/current.md`
- `.omc/digests/competitors-landscape.md`, `.omc/competitors/index.md`, or `.omc/competitors/landscape/current.md`
- `.omc/strategy/index.md`, `.omc/strategy/current.md`, or an explicit strategy path
**Output:** `.omc/ideas/contract/YYYY-MM-DD-<slug>.md` with the Problem Contract.

**Protocol:**
1. Invoke `oh-my-claudecode:ideate` with the problem description and directive: "Phase 1 only — produce the Problem Contract, do not generate ideas yet."
2. Agent reads compact context first, extracts JTBD, known outcomes with Importance/Satisfaction if available, anti-goals, competitors, and constraints.
3. Agent opens full research, competitor, strategy, or prior idea files only by explicit invocation path, slug, or compact index pointer when a citation, score, or named competitor requires it. Do not enumerate `.omc/research/**`, `.omc/competitors/**`, `.omc/strategy/**`, or `.omc/ideas/**`.
4. Writes the Problem Contract yaml block to `.omc/ideas/contract/YYYY-MM-DD-<slug>.md`.
5. Reports: known fields with HIGH confidence, UNKNOWN fields, and a recommendation for ux-researcher or competitor-scout if critical fields are missing.

**HARD STOP:** If the problem statement is too vague to produce a Problem Contract (no identifiable job_executor, no job_statement). Report: "Problem statement too vague — run `/oh-my-claudecode:deep-interview` first to crystallize the problem."

---

## Phase 2 — Method Selection

**Agent:** ideate (single invocation)
**Input:** Problem Contract + `--methods` flag if provided
**Output:** Selected method list with one-sentence justification per method.

**Protocol:**
1. If `--methods` flag provided, use it verbatim.
2. Otherwise, agent applies the selection matrix:

   | Problem type | Primary | Supporting |
   |---|---|---|
   | Technical engine / architecture | TRIZ, First Principles, Morphological | Biomimicry |
   | User-facing UX / workflow | JTBD/ODI, SCAMPER, Jobs Stories | Lateral/PO |
   | Competitive positioning | Blue Ocean, Wardley, Kano | JTBD/ODI |
   | Radical / greenfield | Biomimicry, Lateral/PO, First Principles | TRIZ |
   | Prioritization in a mature zone | JTBD/ODI + Kano | Opportunity Score focus |

3. Selects 3–5 methods total.
4. Records rationale in `.omc/ideas/contract/YYYY-MM-DD-<slug>-methods.md`.

**HARD STOP:** None. If the problem type is unclear, default to JTBD/ODI + First Principles + SCAMPER (lowest-risk balanced set).

---

## Phase 3 — Parallel Divergent Generation

**Agents:** ideate × N (one invocation per selected method, via `/team`)
**Input:** Problem Contract + method assignment
**Output:** One raw idea file per method: `.omc/ideas/raw/YYYY-MM-DD-<method>-<slug>.md`

**Protocol:**
1. Use the current OMC `/team` surface or CLI-first `omc team ...` runtime available in the environment. Do not use deprecated MCP runtime calls such as `TeamCreate` or `TaskCreate`.
2. For each selected method, create one `ideate` role assignment with the directive: "Invoke `oh-my-claudecode:ideate` with `method: <name>` and the Problem Contract path. Produce ≥5 ideas following the method-specific protocol."
3. Tasks run in parallel. Each ideate sub-invocation writes its raw file for the current run only.
4. After all tasks complete, orchestrator reads raw files and verifies each method produced ≥5 ideas. If any method produced <3, re-run that method once with a more aggressive divergence directive; if it still fails, document the failure and continue.

**HARD STOP:** If zero methods produced ≥3 ideas. Report: "Divergent generation failed across all selected methods. Problem statement may be over-specified or contain hidden contradictions. Run `/oh-my-claudecode:deep-interview` to reformulate."

---

## Phase 4 — Clustering & Deduplication

**Agent:** ideate (single invocation)
**Input:** All `.omc/ideas/raw/YYYY-MM-DD-<method>-<slug>.md` files for this run
**Output:** `.omc/ideas/clusters/YYYY-MM-DD-<slug>.md`

**Protocol:**
1. Invoke ideate with directive: "Phase 4 only — cluster and deduplicate. Do not score yet."
2. Agent reads all raw files, groups semantically identical or near-identical ideas, tags each cluster with its source methods.
3. Flags CONVERGENT clusters (surfaced by ≥2 methods).
4. Preserves outliers (single-method, high-novelty) in a dedicated section.
5. Produces stats: total raw, unique clusters, convergent clusters, outliers, diversity ratio.

**HARD STOP:** If diversity ratio < 0.2 (almost all ideas are duplicates). Report: "Low diversity across methods — methods likely covered overlapping territory. Consider re-running with broader method set (add Biomimicry, Lateral/PO)."

---

## Phase 5 — Scoring

**Agent:** ideate (single invocation)
**Input:** Cluster file from Phase 4 + Problem Contract
**Output:** `.omc/ideas/scored/YYYY-MM-DD-<slug>.md` with per-cluster score vectors.

**Protocol:**
1. Invoke ideate with directive: "Phase 5 only — compute score vector per cluster and kept outlier."
2. Agent computes: Opportunity Score, RICE, ICE, Kano hypothesis, Novelty, Moat, Strategic Fit, Time-to-signal, Reversibility — each with confidence HIGH / MEDIUM / LOW.
3. Clusters whose Opportunity Score depends on unmeasured Importance/Satisfaction are flagged LOW confidence and routed to "Requires Validation," not the headline ranking.
4. Shortlist (top ≤7) is drafted from: all CONVERGENT clusters with ≥1 HIGH-confidence dimension, then highest Opportunity Score with HIGH/MEDIUM, then 1–2 outliers with high Novelty × acceptable Strategic Fit.

**HARD STOP:** None. If shortlist is empty, pipeline continues to Phase 6 with an advisory warning.

---

## Phase 6 — Red-team

**Agent:** critic (opus)
**Input:** Shortlist + Problem Contract + `.omc/digests/competitors-landscape.md` or `.omc/competitors/index.md` plus explicit dossier pointers for shortlist analogues
**Output:** `.omc/ideas/redteam/YYYY-MM-DD-<slug>.md`

**Protocol:**
1. Invoke `oh-my-claudecode:critic` with the shortlist file path.
2. Critic runs its standard protocol plus ideation-specific checks:
   - **Premortem (Klein):** Assume the idea has failed 6 months from now; write the most plausible failure story.
   - **Inversion:** What if the opposite idea is correct?
   - **Steelman competitor response:** How does the strongest competitor respond? In how many weeks can they copy?
   - **Survivorship bias check:** On which hidden assumptions about surviving cases does this rest?
   - **Base rate check:** Historical success rate of ideas in this class — cite if known; flag if guessed.
3. Critic produces a verdict per shortlist idea: PASS / REFRAME / REJECT with CRITICAL/MAJOR/MINOR findings.
4. Ideas marked REFRAME are returned to ideate with a single revision pass; REJECTED ideas are archived.

**HARD STOP:** If critic REJECTS the entire shortlist. Report: "All shortlist ideas failed red-team. Pipeline halts. Review critic findings; consider reformulating the problem (deep-interview), gathering more user data (ux-researcher), or expanding method set."

---

## Phase 7 — Experiment Design

**Agent:** ideate (single invocation)
**Input:** Post-red-team shortlist (PASS + REFRAME ideas, post-revision)
**Output:** `.omc/ideas/experiments/YYYY-MM-DD-<slug>.md`

**Protocol:**
1. Invoke ideate with directive: "Phase 7 only — produce an experiment card per shortlist idea."
2. For each idea, agent emits:
   ```yaml
   idea_id: <slug>
   hypothesis: "If we do X for segment Y, metric Z will move by ≥N in T days"
   riskiest_assumption: "<the thing whose falseness kills the idea fastest>"
   experiment_type: fake-door | concierge | wizard-of-oz | smoke-test | prototype-test | A/B | interview
   cost_budget: "<person-days + dollars>"
   kill_criterion: "<signal threshold for closing the idea>"
   success_threshold: "<pre-registered; ≥ this is proceed-to-build>"
   time_to_signal_days: <int>
   ```
3. Prefers the cheapest experiment that falsifies the riskiest assumption (pretotyping).

**HARD STOP:** None.

---

## Phase 8 — Consolidated Report

**Agent:** ideate (single invocation)
**Input:** All prior phase outputs.
**Output:** `.omc/ideas/YYYY-MM-DD-<slug>.md` — the final report (per agent Output_Contract).

**Protocol:**
1. Ideate consolidates Problem Contract, method rationale, clustering stats, convergent ideas, shortlist with score vectors, red-team verdicts, experiment cards, Requires Validation list, Anti-goal Watchlist, and Handoff block.
2. Handoff block names the next steps:
   - `critic` (done — verdict included)
   - `product-strategist` (pending — gate shortlist against anti-goals)
   - `priority-engine` (pending — rank shortlist against existing backlog)
   - `product-pipeline` or backend-pipeline (per shortlist idea, post-prioritization)

</Pipeline_Phases>

<Execution_Policy>
- Phases 0, 4, 5, 7, 8 are sequential single-agent invocations.
- Phase 3 is the only parallel phase, executed via `/team` with one task per method.
- Phase 6 is a mandatory critic invocation — do not skip without explicit `--skip-redteam` flag (and never skip for ideas entering product-pipeline or backend-pipeline).
- HARD STOPs halt the pipeline and report the stop reason plus the remediation path. No phase advances past a HARD STOP without user intervention.
- Resumable via handoff files in `.omc/ideas/` — each phase writes a dated artifact so a re-invocation can resume from the last completed phase.
- Respects `OMC_SKIP_HOOKS` for testing/CI — skips Phase 0 brand-steward prompt.
- Composable with `/oh-my-claudecode:ralph` for retry-on-transient-failure: `/ralph /ideate "..."` wraps the pipeline.
- Composable with `/oh-my-claudecode:autopilot` downstream: pipe a shortlist idea directly into autopilot for execution.
</Execution_Policy>

<Input_Contract>
Primary argument: the problem or feature description string.

```
/ideate "reduce time-to-first-value for new users in our onboarding"
```

Optional flags:
- `--methods=<list>` (comma-separated: jtbd-odi, triz, scamper, blue-ocean, morphological, biomimicry, lateral-po, first-principles)
- `--skip-redteam` (not recommended)
- `--n-ideas=<int>` (default 5)
- `--competitors=<list>` (focus Blue Ocean on named competitors; resolve matching dossiers through `.omc/competitors/index.md` or explicit paths, not by reading all `.omc/competitors/**`)
- `--track=<backend|frontend|both>` (routing hint for downstream pipeline selection)

Quality input characteristics:
- Names a specific user or user-segment (not "users in general").
- States an outcome or pain, not a pre-chosen solution.
- Avoids solution-bias verbs ("add a button") — prefer outcome verbs ("reduce time to...", "let the user achieve...").
- If citations exist in `.omc/research/`, Opportunity Scores will be HIGH confidence; if not, they will be LOW and routed to "Requires Validation."
</Input_Contract>

<Output>
Primary report at `.omc/ideas/YYYY-MM-DD-<slug>.md`:

```markdown
# Ideation Report: <slug>

**Date:** YYYY-MM-DD
**Problem:** <verbatim>
**Constitution:** complete | partial | draft | absent
**Methods:** [jtbd-odi, triz, ...]
**Stats:** raw=N clusters=N convergent=N outliers=N diversity=X.XX

## Problem Contract
<yaml>

## Method Rationale
<one line per method>

## Convergent Ideas
<cross-method; strongest signal>

## Shortlist (top ≤7)
<table + per-idea detail with score vectors, confidence markers, critic verdict, experiment card>

## High-risk / High-reward Outliers
<preserved single-method outliers>

## Requires Validation
<ideas whose headline scores depend on missing user data — lists the specific data needed>

## Anti-goal Watchlist
<ideas flirting with anti-goal boundaries — for product-strategist attention>

## Handoff
- critic: done (verdict per idea above)
- product-strategist: pending (gate shortlist)
- priority-engine: pending (rank against backlog)
- product-pipeline | backend-pipeline: per idea, post-prioritization
```

Supporting artifacts:
- `.omc/ideas/contract/YYYY-MM-DD-<slug>.md` — Problem Contract
- `.omc/ideas/contract/YYYY-MM-DD-<slug>-methods.md` — method selection rationale
- `.omc/ideas/raw/YYYY-MM-DD-<method>-<slug>.md` — per-method raw ideas
- `.omc/ideas/clusters/YYYY-MM-DD-<slug>.md` — clustering working notes
- `.omc/ideas/scored/YYYY-MM-DD-<slug>.md` — score vectors
- `.omc/ideas/redteam/YYYY-MM-DD-<slug>.md` — critic's findings
- `.omc/ideas/experiments/YYYY-MM-DD-<slug>.md` — experiment cards
- `.omc/ideas/current.md` — compact latest shortlist and handoff pointers for downstream agents
- `.omc/ideas/index.md` — compact index of recent reports and shortlist IDs
</Output>

<Failure_Modes_To_Avoid>
- **Running one method and calling it "ideation".** Single-method output is predictable. This skill enforces ≥3 methods; do not bypass without a recorded reason.
- **Skipping red-team to save time.** Critic is the cheapest defense against plausible-but-wrong ideas. Skipping it routes low-quality hypotheses into downstream build pipelines.
- **Headlining ideas whose Opportunity Score is LOW confidence.** Confidence markers are load-bearing. Routing a LOW-confidence idea into product-strategist will produce noise, not signal.
- **Discarding outliers because only one method produced them.** Breakthrough ideas often appear in exactly one method. Preserve; do not silently prune.
- **Ignoring the Anti-goal Watchlist.** Ideas flirting with an anti-goal are the exact cases where the user needs to decide: update the constitution, or reject the idea. Burying them produces latent conflict downstream.
- **Re-running from Phase 0 after a HARD STOP that was cleared.** Each phase writes a dated artifact; resume from the halted phase by reading the last artifact, do not restart.
- **Using this skill for execution.** Ideate produces hypotheses and experiments, not code. Handoff to product-pipeline or backend-pipeline per shortlist idea.
- **Running ideate with no constitution and no override.** Ideas produced without anti-goals are not filterable by product-strategist. At minimum, warn; ideally, run brand-steward first.
- **Skipping Phase 1 Problem Contract.** Without the Contract, methods produce incomparable outputs and clustering degenerates. This phase is non-negotiable.
- **Reading whole archives as context.** Use `.omc/digests/research-highlights.md`, `.omc/research/current.md`, `.omc/digests/competitors-landscape.md`, `.omc/competitors/index.md`, `.omc/competitors/landscape/current.md`, and strategy current/index files first. Open full files only by explicit path, slug, or compact pointer.
- **Creating one file per idea or assumption.** Keep raw method output per method and consolidated artifacts per phase. Do not fan out into unbounded idea/cluster/assumption files.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Uses `/team` infrastructure for Phase 3 through the current native or CLI-first team surface; do not call deprecated MCP runtime tools directly.
- Writes exclusively under `.omc/ideas/` — does not modify constitution, research, strategy, or source code.
- Consumed by `oh-my-claudecode:priority-engine` — ranks ideas from `.omc/ideas/` against the existing backlog.
- Consumed by `oh-my-claudecode:product-pipeline` — post-prioritization, a shortlist idea with UX scope flows into product-pipeline for UX delivery.
- Consumed by backend-pipeline (custom) — post-prioritization, a shortlist idea with backend/engine scope flows into the backend track.
- Composable with `/oh-my-claudecode:ralph` for retry-on-transient-failure.
- Composable with `/oh-my-claudecode:sciomc` for deep parallel research on a specific idea's riskiest assumption before experiment design.
- Composable with `/oh-my-claudecode:deep-interview` upstream — run deep-interview first when the problem statement is not Contract-ready.
- For competitive work, ensure `.omc/competitors/index.md` and `.omc/competitors/landscape/current.md` are populated via competitor-scout or manual research before running — otherwise Blue Ocean output will be LOW confidence.
</Integration_Notes>

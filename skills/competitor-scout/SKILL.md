---
name: competitor-scout
description: Competitive intelligence pipeline with structural recency bias — prioritizes newly-founded and recently-launched entrants via parallel source sweeps; produces evidence-cited dossiers, landscape synthesis, alerts, and a cadence-driven watchlist
argument-hint: "[niche keyword or --refresh]"
level: 4
---

# Competitor Scout Skill

Orchestrates multi-source competitive intelligence with structural bias toward new and emerging entrants. Runs recent-entrant sweep first (Product Hunt, YC, Show HN, funding news, GitHub) before established-player refresh. Each competitor receives an evidence-cited dossier with Disruption classification (Christensen), 7 Powers analysis (Helmer), Wardley position, and a recency-weighted threat score. Output: dossiers, landscape synthesis, material alerts, and a recency-first watchlist with per-competitor scout cadence.

## Usage

```
/oh-my-claudecode:competitor-scout [niche keyword]
/competitor-scout [niche keyword]
/competitor-scout --refresh                    # refresh existing watchlist per cadence rules
/competitor-scout --new-only                   # sweep only recency-sensitive sources
/competitor-scout --alert <slug>               # deep-dive on a specific competitor after an alert
```

### Examples

```
/competitor-scout "project management for engineering teams"
/competitor-scout "ai code review"
/competitor-scout --refresh
/competitor-scout --new-only "vector database"
/competitor-scout --alert anysphere             # deep-dive after a funding alert
```

### Flags

- `--refresh` — run Phase 3 (established refresh) against every competitor in watchlist whose `last_scout` is older than `freshness_budget_days`. Skips Phase 2 unless combined with `--new-only`.
- `--new-only` — run only recency-biased Phase 2 sources; skip established refresh. Useful for daily/weekly pulses.
- `--alert <slug>` — deep-dive on a single competitor; skip discovery; produce one dossier + one alert.
- `--force-refresh` — ignore `freshness_budget_days`; re-scout even recently-touched competitors.
- `--geo=<list>` — scope to specific geographies (default: inherit from constitution).
- `--sources=<list>` — override default source mix; e.g., `--sources=producthunt,yc,hn,github`.
- `--recency-quota=<float>` — override default 0.6 minimum recency share (never below 0.4).

<Purpose>
Single orchestrated pipeline that converts "who is competing with us right now?" into a decision-ready artifact set. Enforces non-skippable context loading, a hard quota on recency-sensitive sources (≥60% of discovery queries by default), parallel multi-source sweeps, per-competitor dossier construction with evidence citations, cross-competitor landscape synthesis, material-event alerts, and a cadence-driven watchlist update. Halts at HARD STOPs (no discovery tools available, or zero citable candidates after a full sweep) with explicit remediation.
</Purpose>

<Use_When>
- Regular pulse on the competitive landscape is needed (weekly / biweekly cadence).
- A funding round, launch, or pivot by a competitor has been surfaced and needs a structured response.
- Ideate or priority-engine is about to run and the competitors file is older than a strategy cycle.
- A new initiative is being planned and the target niche has not been scouted.
- Quarterly / pre-planning strategic review.
</Use_When>

<Do_Not_Use_When>
- You already have a named competitor and only need product-strategist evaluation — use product-strategist with the competitor name in the prompt.
- The question is "how is our UX worse than competitor X" — use ux-researcher after scout has produced the dossier.
- You want to generate counter-moves — use ideate with the scout output as context.
- Internal code review / refactoring — unrelated.
</Do_Not_Use_When>

<Why_This_Exists>
OMC's ideation and strategy agents reference `.omc/competitors/` but nothing populates it. A dossier file written once and never refreshed is worse than no dossier — it creates false confidence. This skill fills the gap and enforces the discipline: structural recency bias, evidence citation, multi-framework classification, and cadence-driven refresh.

Competitive surprise almost always comes from invisible entrants — low-end and new-market disruptors (Christensen) that are too small to appear on incumbent competitor maps until they are past the strategic response window. A competitive-intelligence function that weights established players equally with 3-month-old YC startups is structurally blind to the threats that matter. This skill allocates ≥60% of scouting budget to recency-sensitive sources by default, and the underlying agent refuses to deviate without a logged reason.

Additionally, LLM-based competitor analysis without citation discipline is actively harmful: hallucinated competitors and fabricated founding dates corrupt downstream ideation, priority-engine rankings, and strategic decisions. Every factual claim in this pipeline requires a URL with retrieval date, or explicit tagging as inference / LLM-domain-knowledge.
</Why_This_Exists>

<Pipeline_Phases>

## Phase 0 — Foundation and Capability Check

**Agent:** competitor-scout (single invocation)
**Input:** `.omc/constitution.md`, `.omc/competitors/**`, `.omc/research/**`, `.omc/ideas/**`
**Output:** Scouting Contract at `.omc/competitors/contract/YYYY-MM-DD-<slug>.md`

**Protocol:**
1. Verify at least one discovery tool is available: `mcp__linkup__linkup-search`, `WebSearch`, or `WebFetch`. If none → HARD STOP.
2. Read constitution (niche, target user, anti-goals).
3. Read existing watchlist and dossiers — note last_scout per competitor.
4. Read recent `.omc/ideas/**` to infer which competitive surfaces matter this cycle.
5. Emit Scouting Contract.

**HARD STOP:** No discovery tools available. Report: "Competitor scouting requires web access tools. Install `linkup` MCP server or enable WebSearch / WebFetch. Without these, scout would produce LLM-domain-knowledge only — unreliable by design."

**HARD STOP:** Constitution absent AND user has not provided niche argument. Report: "Cannot scope scout without niche. Either run `/oh-my-claudecode:brand-steward` first, or invoke with an explicit niche keyword."

---

## Phase 1 — Source Plan

**Agent:** competitor-scout (single invocation)
**Input:** Scouting Contract
**Output:** Source plan file with per-source query budget.

**Protocol:**
1. Apply default source mix (≥60% recency) unless `--sources` or `--recency-quota` flag overrides.
2. Compute concrete queries per source, adapted to niche keywords.
3. Write plan to `.omc/competitors/contract/YYYY-MM-DD-<slug>-plan.md`.

Default plan shape (orchestrator may not alter without user flag):

| Bucket | Share | Example sources |
|---|---|---|
| Recent (≥60%) | 60–80% | Product Hunt last 90d, YC last 2 batches, Show HN/Launch HN, recent funding news, GitHub created-in-last-12mo |
| Established refresh | 15–25% | Existing watchlist entries past freshness_budget_days |
| Cross-cut synthesis | 15–25% | Strategy canvas, perceptual map, Wardley |

**HARD STOP:** None; skill clamps quota to ≥0.4 even if user flag tries lower.

---

## Phase 2 — Recent-Entrant Sweep (PRIORITY, PARALLEL)

**Agents:** competitor-scout × N (one invocation per source via `/team`)
**Input:** Source plan + niche keywords
**Output:** Per-source candidate lists → `.omc/competitors/candidates/YYYY-MM-DD-<source>.md`

**Protocol:**
1. Create a team session via TeamCreate.
2. For each recency source, TaskCreate with directive: "Invoke `oh-my-claudecode:competitor-scout` with `source: <name>` and the scouting contract. Produce candidate list with required fields (slug, homepage_url, discovery_source, claimed_founding, initial_positioning_quote, corroborating_sources)."
3. Tasks run in parallel. Each sub-invocation writes its candidate file with citations.
4. After all tasks complete, orchestrator merges candidate lists and deduplicates by slug / homepage.
5. Candidates with ≥3 independent sources → promoted to Phase 4 dossier creation. Candidates with 1–2 sources → `.omc/competitors/unverified/<slug>.md` (Emerging Signal).

**HARD STOP:** Zero candidates found across all sources after a full sweep. Report: "No competitors surfaced. Either niche is not tracked by recency sources (niche too new, too narrow, or too technical), or discovery tools failed. Broaden keywords or switch sources."

---

## Phase 3 — Established-Player Refresh

**Agent:** competitor-scout (sequential per competitor; may parallelize small batches via `/team`)
**Input:** Watchlist entries past `freshness_budget_days`
**Output:** Updated dossier per refreshed competitor.

**Protocol:**
1. For each qualifying watchlist entry, check for material changes: homepage copy, pricing, releases, blog cadence, exec moves, funding, job posts.
2. If material change detected → full dossier refresh (Phase 4) + alert (Phase 6).
3. If no change → append a lightweight "no-change" record to dossier history and bump last_scout.

**HARD STOP:** None; Phase 3 is skippable if watchlist is empty or all entries are within freshness_budget_days.

---

## Phase 4 — Per-Competitor Dossier

**Agent:** competitor-scout (one invocation per new competitor OR per refreshed established competitor)
**Input:** Candidate record or refresh findings
**Output:** `.omc/competitors/<slug>/YYYY-MM-DD-dossier.md`

**Protocol:**
1. For each promoted candidate, invoke scout with directive: "Produce full dossier per the Output_Contract. Apply Disruption / 7 Powers / Wardley / Blue Ocean classification. Compute recency-weighted threat score. Identify weaknesses and attack surfaces."
2. Dossier must carry confidence tags (CITED / INFERRED / DOMAIN) on every fact.
3. Weaknesses and Attack Surfaces section is mandatory — no empty placeholders. If no weakness found, record "no leverage found in this scout; recommended deep-dive source: ..." explicitly.

**HARD STOP:** Dossier produced without citation URLs. Auto-reject and re-run with stricter directive.

---

## Phase 5 — Landscape Synthesis

**Agent:** competitor-scout (single invocation)
**Input:** All dossiers produced or refreshed in this session
**Output:** `.omc/competitors/landscape/YYYY-MM-DD.md`

**Protocol:**
1. Produce strategy canvas (Blue Ocean factors × competitors).
2. Produce perceptual map on two niche-relevant axes.
3. Produce Wardley snapshot (competitors by evolution stage).
4. Produce disruption matrix (sustaining / low-end / new-market / non-disruptive adjacent).
5. Produce JTBD coverage heatmap — explicitly name white space.
6. Summarize Power distribution (how many have ≥2 mature Powers).

**HARD STOP:** None.

---

## Phase 6 — Alerts

**Agent:** competitor-scout (single invocation; one file per event)
**Input:** Material events detected in Phases 2–3
**Output:** `.omc/competitors/alerts/YYYY-MM-DD-<slug>-<event>.md`

**Protocol:**
1. For each material event (funding, launch, pivot, exec change, pricing shift, acquisition), emit an alert file.
2. Alerts for `new` and `emerging` competitors are mandatory on every material event.
3. Alerts for `established` competitors are emitted only on high-severity events.
4. Each alert includes threat-score delta and a Recommended action with hand-off target.

**HARD STOP:** None.

---

## Phase 7 — Watchlist and Cadence

**Agent:** competitor-scout (single invocation)
**Input:** All updated dossiers
**Output:** Updated `.omc/competitors/watchlist.md` (recency-first sort)

**Protocol:**
1. Recompute threat scores (may change after dossier updates).
2. Apply cadence rules:
   - `new` (< 6mo): re-scout every 7 days.
   - `emerging` (< 18mo): every 14 days.
   - `established` (≥ 18mo): every 30 days (60 if power_maturity low AND velocity low).
3. Competitors whose threat_score declined for 3 consecutive scouts AND velocity declined → move to `.omc/competitors/archive/` with reason.
4. Sort watchlist: `new` (by threat_score desc), then `emerging`, then `established`.

**HARD STOP:** None.

---

## Phase 8 — Consolidated Session Report

**Agent:** competitor-scout (single invocation)
**Input:** All prior phase outputs
**Output:** Terminal summary + pointer to artifacts.

**Protocol:**
1. Emit a one-screen summary:
   - Session duration and recency-quota achieved.
   - Counts: new candidates surfaced, unverified quarantined, dossiers produced / refreshed, alerts emitted.
   - Top 5 threats (by threat_score, recency-first).
   - White space identified in JTBD coverage.
   - Recommended next actions with hand-off targets (ideate, product-strategist, critic).

</Pipeline_Phases>

<Execution_Policy>
- Phase 0, 1, 4 (per competitor), 5, 6 (per event), 7, 8 are sequential single-agent invocations.
- Phase 2 is mandatory parallel via `/team` — one task per recency source.
- Phase 3 may parallelize in small batches if >10 refresh targets.
- Default recency quota is 0.6; hard-clamped to ≥0.4 even on user override.
- HARD STOPs halt the pipeline with the reason and required remediation path.
- Resumable: each phase writes dated artifacts. Re-invocation reads prior outputs and resumes.
- Respects `OMC_SKIP_HOOKS` for CI/testing.
- Composable with `/oh-my-claudecode:loop` for recurring cadence: `/loop 7d /competitor-scout --refresh` runs weekly pulse.
- Composable with `/oh-my-claudecode:ralph` for retry-on-transient-failure: `/ralph /competitor-scout "..."`.
- Composable with `/oh-my-claudecode:ideate` downstream: alerts on `new` competitors auto-hand-off to ideate for counter-move generation.
</Execution_Policy>

<Input_Contract>
Primary argument (optional): niche keyword string.

```
/competitor-scout "vector database for agentic memory"
/competitor-scout --refresh
/competitor-scout --alert anysphere
```

If no argument provided AND `--refresh` not set AND no niche in constitution → HARD STOP (Phase 0).

Flags summarized:
- `--refresh` — established refresh only
- `--new-only` — Phase 2 only
- `--alert <slug>` — deep-dive single competitor
- `--force-refresh` — ignore freshness_budget_days
- `--geo=<list>` — geographic scope
- `--sources=<list>` — override source mix
- `--recency-quota=<float>` — override default 0.6 (floor 0.4)
</Input_Contract>

<Output>
Session artifacts:

- `.omc/competitors/contract/YYYY-MM-DD-<slug>.md` — Scouting Contract + source plan
- `.omc/competitors/candidates/YYYY-MM-DD-<source>.md` — per-source raw candidates (Phase 2)
- `.omc/competitors/unverified/<slug>.md` — quarantined 1–2 source candidates
- `.omc/competitors/<slug>/YYYY-MM-DD-dossier.md` — per-competitor dossier
- `.omc/competitors/landscape/YYYY-MM-DD.md` — strategy canvas + perceptual map + Wardley + disruption matrix + JTBD heatmap
- `.omc/competitors/alerts/YYYY-MM-DD-<slug>-<event>.md` — material-event alerts
- `.omc/competitors/watchlist.md` — recency-first watchlist with next-scout cadence
- `.omc/competitors/archive/<slug>/` — demoted-by-rule competitors

Watchlist schema (excerpt):

```markdown
# Competitor Watchlist

Last updated: YYYY-MM-DD

## New (< 6mo) — scout every 7 days
| slug | threat | last_scout | next_scout | dossier |
|---|---|---|---|---|
| ... | 8.4 | 2026-04-19 | 2026-04-26 | <path> |

## Emerging (< 18mo) — scout every 14 days
...

## Established (≥ 18mo) — scout every 30 days
...

## Archived
...
```
</Output>

<Failure_Modes_To_Avoid>
- **Filling the output with competitors from LLM training data.** Without a retrieved URL and retrieval date, a competitor is a hallucination. Unverified or excluded.
- **Treating "I saw a tweet about them" as one source.** Three articles citing the same press release = one source. Count independent origins.
- **Spending the majority of the budget on the comfort-zone established players.** The whole skill exists to resist this. Enforce the ≥60% recency quota.
- **Declaring a competitor non-threatening because they are small.** Small + recent + VC-backed + counter-positioned is exactly the Christensen disruptor profile. Recency multiplier in threat scoring exists for this reason.
- **Producing dossiers without Weaknesses and Attack Surfaces.** Intelligence without actionable leverage is decoration.
- **Running weekly `--refresh` and missing new entrants.** Refresh by itself is blind to new entrants. Either run `--new-only` weekly and `--refresh` biweekly, or run the full pipeline.
- **Updating the watchlist without re-computing threat scores.** Scores change after a dossier updates; stale scores mis-rank the list.
- **Skipping the unverified quarantine to "speed things up".** Promoting single-source candidates pollutes the watchlist and wastes downstream agent attention on ghosts.
- **Inventing team sizes or funding numbers from LinkedIn-adjacent guesses.** If the number is not cited, it is unknown. Say unknown.
- **Continuing to scout a dead competitor.** Three consecutive scout drops + velocity decline → archive with reason.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Reads constitution for niche and anti-goals. Reads research for JTBD (to catch non-obvious substitutes). Reads ideas to infer which competitive surfaces matter this cycle.
- Writes exclusively under `.omc/competitors/**`.
- Consumed by `oh-my-claudecode:ideate` — dossiers feed Blue Ocean method in Phase 2 of ideate, and attack surfaces inform counter-move generation.
- Consumed by `oh-my-claudecode:priority-engine` — alerts and landscape shifts feed the ranking inputs.
- Consumed by `oh-my-claudecode:product-strategist` — strategic shifts and counter-positioning threats trigger constitution review.
- Uses MCP tools when available: `mcp__linkup__linkup-search`, `mcp__linkup__linkup-fetch`; otherwise `WebSearch` / `WebFetch`.
- Cadence automation: pair with `/oh-my-claudecode:loop` or `/oh-my-claudecode:schedule` to run `--refresh` weekly and full pipeline monthly.
- Alert fan-out: downstream automation can tail `.omc/competitors/alerts/` for CI-side notifications.
- For an aggressive-competition posture, configure `.omc/constitution.md` anti-goals and target-user sections carefully — scout filters on these to avoid chasing adjacent-but-irrelevant players. A vague constitution produces a noisy watchlist.
</Integration_Notes>

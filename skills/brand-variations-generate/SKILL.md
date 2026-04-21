---
name: brand-variations-generate
description: Generate N brand-coherent variations of a campaign / marketing expression / design direction using brand grammar. Pipeline campaign-composer (generate) → creative-director (enforce). Output ready for downstream execution
argument-hint: "<brief-path OR inline-brief>"
level: 4
---

# Brand Variations Generate Skill

Orchestrates the generative side of the brand system: takes a campaign brief + brand grammar, produces N variations through `campaign-composer`, then runs `creative-director` for grammar enforcement and variance gate. The workflow passes compact brand/competitor context and the fresh expression directory, not historical archives. Output is a reviewed variation set ready for downstream design / copy / execution teams.

## Usage

```
/oh-my-claudecode:brand-variations-generate "<brief>"
/brand-variations-generate <path-to-brief.md>
/brand-variations-generate "<brief>" --n=8
/brand-variations-generate "<brief>" --channels=email,landing,tiktok
```

### Examples

```
/brand-variations-generate "Q1 launch campaign targeting Ravelry defectors, channels email + landing + instagram, goal activation, launch date 2026-06-01"
/brand-variations-generate .omc/briefs/launch-q2.md --n=8
/brand-variations-generate "seasonal autumn campaign" --channels=instagram,email
```

### Flags

- `--n=<int>` — number of variations to generate (default 6; minimum 3; maximum 12).
- `--channels=<list>` — comma-separated channel list (email / landing / instagram / tiktok / billboard / in-app / press). Overrides brief.
- `--force-regenerate-on-fail` — if creative-director REJECTs >50%, auto-regenerate failing variations once (default: ask user).
- `--skip-director` — skip creative-director pass (NOT recommended; output is unvalidated drafts).

<Purpose>
Single command that converts a campaign brief into a grammar-enforced variation set. Runs composer-then-director to guarantee every variation is (a) brand-coherent (invariants satisfied), (b) mutually distinct (variance gate), (c) not echoing competitors. Output is a set of variation specs with director's verdict per variation.
</Purpose>

<Use_When>
- You have a brand/core.md + grammar.md and want to generate a campaign, landing-page direction, seasonal refresh, or marketing-channel variant set.
- You need to test multiple brand-coherent expressions before committing design/copy resources.
- You want to hand execution teams a validated spec-set, not one rushed concept.
</Use_When>

<Do_Not_Use_When>
- No `.omc/brand/core.md` or grammar.md exists — run `/brand-architect` first.
- You need a single final asset, not exploration — use designer / copywriter directly.
- You want to re-evaluate the brand SYSTEM itself — use `/brand-architect --refine`.
- Single-feature UI work inside the product — use designer (this is for marketing / brand-level expressions).
</Do_Not_Use_When>

<Pipeline_Phases>

## Phase 0 — Prerequisite Check

1. Verify `.omc/brand/core.md` exists and `status: partial` or `complete`.
2. Verify `.omc/brand/grammar.md` exists and `status: partial` or `complete`.
3. Verify `.omc/brand/inspiration.md` exists and contains at least 3 sources, or HARD STOP: "Inspiration library required. Run `/brand-architect --inspiration` first."
4. Read `.omc/brand/index.md` if present for current artifact pointers and readiness flags. Do not scan `.omc/brand/**`.
5. If core or grammar is missing → HARD STOP: "Brand system required. Run `/brand-architect` first."

## Phase 1 — Brief Ingestion

Parse input:
- If positional arg is a path, read it.
- If inline, parse into structured brief:

```yaml
campaign_slug: <kebab-case derived from brief>
goal: awareness | activation | retention | launch | seasonal | other
audience: <segment>
channels: [<list>]
season_context: <timeline>
primary_cta: <action>
constraints: [<forbidden words, mandatory inclusions>]
success_metric: <pre-registered>
n_variations: <from --n flag or default 6>
```

If fields are missing (especially audience, channels, goal) → request from user before proceeding. Do not fabricate.

## Phase 2 — Generate (campaign-composer)

Invoke `oh-my-claudecode:campaign-composer` agent with directive:
- Read `.omc/brand/index.md` if present, brand/core, brand/grammar, brand/inspiration, the brief, and compact competitor context (`.omc/digests/competitors-landscape.md`, `.omc/competitors/index.md`, or `.omc/competitors/landscape/current.md`). Do not read `.omc/brand/**`, `.omc/competitors/**`, or historical expression directories.
- Generate N variations per the agent's Investigation_Protocol.
- Enforce variance gate: ≥2 variables must exhibit ≥2 distinct values across the set.
- Write to `.omc/brand/expressions/YYYY-MM-DD-<campaign-slug>/`, `.omc/brand/expressions/current.md`, and `.omc/brand/expressions/index.md`.

**HARD STOP:** Composer returns `malformed_grammar` or cannot satisfy invariants (brief conflicts with grammar). Report conflict; user decides: adjust brief OR refine grammar via brand-architect.

## Phase 3 — Enforce (creative-director)

Invoke `oh-my-claudecode:creative-director` agent with directive:
- Read brand/index if present, brand/core, brand/grammar, brand/inspiration, `.omc/brand/expressions/YYYY-MM-DD-<campaign-slug>/INDEX.md`, its variation files, and compact competitor context. Do not read historical `.omc/brand/expressions/**` unless the director explicitly needs a bounded recent-campaign sample from `.omc/brand/expressions/index.md`.
- Run invariant check, variance gate, near-duplicate detection, competitor-echo check, and bounded brand-drift-over-time.
- Produce per-variation verdict (PASS / REVISE / REJECT).
- Write review to `.omc/brand/reviews/YYYY-MM-DD-<campaign-slug>.md`, then update `.omc/brand/reviews/current.md` and `.omc/brand/reviews/index.md`.

## Phase 4 — Remediation Loop

Based on director's review:

- **All PASS** → emit success summary; campaign variations ready for designer + copywriter.
- **Some REVISE** → either auto-loop (if `--force-regenerate-on-fail`) back to Phase 2 for those specific variations, or report revisions needed and ask user to proceed.
- **Campaign-level BLOCKED (variance gate failure)** → report that composer's plan did not exercise variables sufficiently; re-invoke composer with explicit divergence directive once. If still failing, escalate to brand-architect (grammar may be under-varied).
- **Many REJECTs** → grammar or brief mismatch. Escalate to user with diagnostic: either brief conflicts with grammar, or grammar needs review.

Max iterations: 2 composer regenerations before final user-decision.

## Phase 5 — Summary Report

Produce terminal summary:

```
Campaign: <slug>
Variations: N generated
Verdicts: pass=X revise=Y reject=Z
Variance gate: pass | fail
Competitor-echo: pass | skipped | N conflicts
Brand-drift-over-time: N signals | clean

Approved variations ready for:
  - designer: <list of passing variations → visual production>
  - copywriter: <list → final copy polish>

Blocked / revision-needed:
  - <variation>: <reason + specific grammar reference>

Artifacts:
  - .omc/brand/expressions/YYYY-MM-DD-<slug>/ (N variation files + INDEX.md)
  - .omc/brand/reviews/YYYY-MM-DD-<slug>.md (director review)
```

</Pipeline_Phases>

<Execution_Policy>
- Phase 0 + 1 + 5 sequential; Phase 2 and Phase 3 sequential (director waits for composer).
- Phase 4 loops at most twice; third failure escalates to user.
- HARD STOPs halt the pipeline with explicit remediation.
- Each invocation writes dated artifacts enabling resumption and diffing.
- Composes with `/oh-my-claudecode:loop` for recurring seasonal campaigns (e.g., `/loop 90d /brand-variations-generate "seasonal quarterly refresh"`).
</Execution_Policy>

<Input_Contract>
Primary argument: brief (inline string OR path to .md file in `.omc/briefs/`).

Required brief fields (if missing, skill prompts user):
- goal
- audience
- channels
- context / season / timeline
- primary CTA
- success metric (pre-registered)
</Input_Contract>

<Output>
- `.omc/brand/expressions/YYYY-MM-DD-<campaign-slug>/` (INDEX.md + variation-01…0N.md)
- `.omc/brand/expressions/current.md` and `.omc/brand/expressions/index.md`
- `.omc/brand/reviews/YYYY-MM-DD-<campaign-slug>.md` (director verdict)
- `.omc/brand/reviews/current.md` and `.omc/brand/reviews/index.md`
- Terminal summary with next-action recommendations per downstream agent.
</Output>

<Failure_Modes_To_Avoid>
- **Running without brand/core.md + grammar.md.** HARD STOP enforced.
- **Skipping creative-director.** Output without director review is unvalidated; not production-ready.
- **Looping regeneration forever when grammar is the problem.** Max 2 regenerations; after that, escalate to brand-architect (grammar may be flawed).
- **Fabricating brief fields because the user didn't provide them.** Prompt user for missing fields; never assume audience or goal.
- **Passing the whole variation set to execution teams without director's per-variation verdicts.** Designers/copywriters need verdict evidence to prioritize production.
- **Ignoring brand-drift-over-time signals.** Even if current campaign passes, cumulative drift matters; surface in summary.
- **Reading whole brand or competitor archives from the wrapper.** Use brand index/current artifacts, compact competitor context, and the fresh expression directory only.
- **Creating extra sidecar artifacts for checks.** Composer and director outputs are already structured; scans, failed candidates, and matrices belong in `INDEX.md`, variation files, or the director review.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Depends on: `oh-my-claudecode:campaign-composer`, `oh-my-claudecode:creative-director`, and `.omc/brand/index.md` + core/grammar/inspiration from `/brand-architect`.
- Composes with: `/oh-my-claudecode:loop` for recurring campaign cadence; `/oh-my-claudecode:competitor-scout` (fresher data = better echo detection).
- Consumed by: designer + copywriter for production; user for final selection among approved variations.
- If brief itself feels wrong (e.g., targets segment constitution doesn't recognize), escalate to `/product-strategist` for constitution alignment check.
</Integration_Notes>

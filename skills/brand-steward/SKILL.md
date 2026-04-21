---
name: brand-steward
description: Slash-wrapper for the brand-steward agent — invokes research-driven SYNTHESIS of brand identity (mission, target user, anti-goals, tone, scope). Reads .omc/ideas/ + .omc/competitors/ + .omc/research/ and presents validated hypotheses for founder to judge. Hard-stop gate refuses to proceed without vision source; in post-MVP mode also requires competitors+research; pre-MVP mode (--pre-mvp) accepts missing competitors/research with LOW-confidence markers. Opt-in depth mode via --deep adds value ladders, productive tensions, archetypal seed, semiotic codes, antagonism map as additional hypothesis categories. Founder is judge + source of vision/taste, not source of answers
argument-hint: "[--session1 | --session2 | --refine] [--pre-mvp | --post-mvp] [--deep | --philosophy | --depth | --shallow]"
level: 4
---

# Brand Steward Skill

Minimal slash-wrapper for the `brand-steward` agent. The wrapper enforces the research-completeness gate (hard-stop), detects depth-mode flags, and hands off to the agent via direct Task invocation with a synthesis-first directive. All brand-identity content is SYNTHESIZED from research / competitors / ideation or spec data — the founder validates hypotheses, does not generate them from scratch.

## Usage

```
/oh-my-claudecode:brand-steward                      # post-MVP (default), auto-session, standard synthesis
/brand-steward --session1                            # first pass, post-MVP, standard synthesis
/brand-steward --session2                            # refinement pass (delta against prior constitution)
/brand-steward --refine                              # open-ended refinement
/brand-steward --deep                                # post-MVP, depth synthesis (10 hypothesis categories)
/brand-steward --session1 --deep                     # first pass with extended hypothesis set
/brand-steward --session2 --philosophy               # refinement with extended hypothesis set (alias for --deep)
/brand-steward --session2 --shallow                  # refine depth-mode constitution in standard posture (opt-out)
/brand-steward --pre-mvp                             # pre-MVP mode: vision source required, competitors/research soft
/brand-steward --pre-mvp --deep                      # pre-MVP depth synthesis (expect many LOW confidence markers)
/brand-steward --session1 --pre-mvp                  # explicit pre-MVP first session
/brand-steward --session2 --post-mvp                 # force post-MVP posture in session 2 (override continuation of prior pre-MVP)
```

Session flags, phase flags (pre-mvp/post-mvp), and depth flags all compose independently. `--deep`, `--philosophy`, and `--depth` are synonyms. `--premvp` and `--early-stage` are aliases for `--pre-mvp`. Natural-language triggers for both depth mode and pre-MVP mode are recognized in the user's first message by the agent:
- Pre-MVP keywords: "pre-mvp", "до mvp", "нет mvp", "ещё не начали", "no mvp yet", "haven't built anything", "no users yet", "early stage"
- Depth keywords: "глубинный режим", "сложная философия", "боюсь поверхностных ответов", "deep mode", "go deep"

The wrapper only parses explicit flags; natural-language detection lives in the agent.

<Purpose>
Single command that invokes `brand-steward` agent to do research-driven synthesis of product identity. The wrapper is intentionally thin: it enforces the research-gate, detects session + depth modes, and invokes the agent. Everything else — reading data, synthesizing hypotheses, presenting for validation, revising on feedback, capturing vision/taste — happens inside the agent dialog directly with the user. The wrapper produces NO user-facing output except the hard-stop refusal when the research-gate fails.
</Purpose>

<Use_When>
- **Post-MVP founding** (default) — research already collected: vision source (`.omc/ideas/` OR `.omc/specs/`), `.omc/competitors/` (≥3 dossiers), `.omc/research/` (≥1 synthesis artifact) are in place, you want the first constitution.
- **Pre-MVP founding** (`--pre-mvp`) — product not yet built, no users to research, competitor scouting may be partial. You want a hypothesis-grade constitution to direct the first build and guide which research to do first. Vision source still required; constitution will be capped at `status: partial` until session 2 with research promotes it to `post-mvp` and potentially `complete`.
- **Refinement phase** (session 2) — after 10–14 days of accumulated product data (or after pre-MVP → post-MVP transition when research wave completes), re-synthesize and present deltas against existing constitution.
- **Material market shift** — new competitor dossier, research wave, regulatory change — that may invalidate existing anti-goals / positioning.
- **Product strategy pivot** — when ideate or specs have new vision material and prior constitution is now stale.
</Use_When>

<Do_Not_Use_When>
- Research inputs are missing or thin. The skill will hard-stop and recommend running `/deep-interview` or `/ideate` (one vision source required), `/competitor-scout`, `/ux-researcher` first. Do NOT attempt to "just brainstorm" constitution via this skill — it is explicitly designed to refuse that mode.
- You need archetype / visual system / grammar — use `/brand-architect` (reads this skill's output; does full 12-archetype analysis).
- You need specific copy polish — use copywriter agent directly.
- Single-feature evaluation — use `/product-strategist`.
</Do_Not_Use_When>

<Protocol>

## Phase 0 — Mode Detection + Research-Completeness Gate + Session + Depth Detection

Read silently (no output to user):
1. `.omc/constitution.md` if exists — note `status` field.
2. Vision source context: `.omc/ideas/current.md` or `.omc/ideas/index.md`; `.omc/specs/current.md` or `.omc/specs/index.md`. If indexes are absent, do metadata-only counts of non-empty files; do not read archive contents.
3. Compact competitor context: `.omc/digests/competitors-landscape.md`, else `.omc/competitors/landscape/current.md`, else `.omc/competitors/index.md`, else metadata-only count. Do not enumerate competitor archives into prompt context.
4. Compact research context: `.omc/digests/research.md` or `.omc/digests/research-highlights.md`, else `.omc/research/current.md`, else `.omc/research/index.md`, else newest 1-3 synthesis artifacts. Do not enumerate raw research archives.
5. Compact brand context: `.omc/digests/brand-core.md`, else `.omc/brand/index.md`, else `.omc/brand/core.md` + `.omc/brand/grammar.md` if present.

**Phase detection** (from args + context):
- `--pre-mvp` / `--premvp` / `--early-stage` flag → `phase: pre-mvp`.
- `--post-mvp` flag → `phase: post-mvp`.
- Prior constitution has `phase: pre-mvp` AND user did NOT pass `--post-mvp` → continue with `phase: pre-mvp`.
- Otherwise → `phase: post-mvp` (default).

Natural-language pre-MVP triggers in the user's first message (recognized by the AGENT, not the wrapper): "до mvp", "нет mvp", "ещё не начали", "no mvp yet", etc. The wrapper only parses explicit flags.

**Research-gate (hard-stop enforcement) — branches by phase:**

**Post-MVP mode (default):**
- If BOTH `.omc/ideas/` AND `.omc/specs/` are missing OR empty → FAIL GATE (need at least ONE vision source)
- If `.omc/competitors/` missing OR has fewer than 3 dossiers → FAIL GATE
- If `.omc/research/` missing OR empty → FAIL GATE

**Pre-MVP mode (`--pre-mvp`):**
- If BOTH `.omc/ideas/` AND `.omc/specs/` are missing OR empty → FAIL GATE (vision source still required)
- If `.omc/competitors/` missing OR <3 dossiers → NOT a gate fail; pass `degraded_inputs: [competitors_below_minimum]` to agent
- If `.omc/research/` missing OR empty → NOT a gate fail; pass `degraded_inputs: [research_absent_or_light]` to agent
- Agent will proceed with synthesis, marking affected sections LOW confidence or CANNOT-SYNTHESIZE (enforced by agent, not wrapper)

**If gate FAILS**, the wrapper does NOT invoke the agent. Instead, the wrapper passes a `gate_failure: <details>` directive to the agent via Task tool so the agent emits its structured refusal (documented in its `<Synthesis_Protocol>` Phase 0). The refusal lists what's missing, why each input is required, and the recommended remediation sequence (`/ideate`, `/competitor-scout`, `/ux-researcher`). Session terminates. No constitution written.

The hard-stop is intentional and non-negotiable: synthesis-first design depends on having data to synthesize from. Falling back to interview mode when data is missing reproduces the exact failure mode this agent was redesigned to prevent.

**If gate PASSES**, proceed to session + depth detection.

**Session mode** (from args + context):
- `--session1` flag OR constitution absent OR `status: draft` with no fills → session 1.
- `--session2` flag OR (`status: partial` AND this is not a first invocation) OR (`status: partial` AND compact competitor/research context exists) → session 2.
- `--refine` → open-ended refinement.

**Depth mode** (orthogonal to session mode):
- Any of `--deep`, `--philosophy`, `--depth` in args → `depth_mode: true`.
- `--shallow` flag → `depth_mode: false` (explicit opt-out; relevant when prior constitution has `depth_mode: true` but founder wants standard posture for this session).
- If no depth flag AND prior `.omc/constitution.md` has `depth_mode: true` AND no `--shallow` → `depth_mode: continue` (maintain depth posture).
- If no depth flag AND no prior depth constitution → `depth_mode: false` (standard).
- Natural-language detection in the user's first message (e.g., "глубинный режим") is handled by the AGENT, not the wrapper. The wrapper only parses explicit flags.

## Phase 1 — Direct Invocation with Synthesis Directive

Invoke `oh-my-claudecode:brand-steward` agent via Task tool (NOT as a teammate, NOT through a relay channel). The agent runs in a direct conversational channel with the user.

**Invocation directive** (passed in Task prompt):

```
Session mode: [1 | 2 | refine]
Phase: [pre-mvp | post-mvp]
Depth mode: [true | false | continue]
Gate status: [passed | failed-with-<details>]
Degraded inputs: [<list or empty>]  # e.g., ["competitors_below_minimum", "research_absent_or_light"] — only populated in pre-MVP when competitors <3 or research missing
Available compact context paths:
  - constitution: <path or absent>
  - vision_source_context: <current/index/explicit path list>
  - competitor_context: <digest/current/index path list>
  - research_context: <digest/current/index path list>
  - brand_context: <digest/current/index path list>
Research sources present:
  - ideas_files: <N>       # from /ideate output at .omc/ideas/
  - specs_files: <N>       # from /deep-interview output at .omc/specs/
  - vision_source_used: <"ideas" | "specs" | "both" | "none">
  - competitor_dossiers: <N>
  - research_artifacts: <N>
Prior constitution: [absent | draft | partial | complete]
Prior constitution phase: [null | pre-mvp | post-mvp]
Prior brand artifacts: [absent | present]

Instructions:
- Execute Synthesis_Protocol per agent prompt.
- If gate passed: proceed Phase 1 (silent synthesis) → Phase 2 (hypothesis presentation) → Phase 3 (revision) → Phase 4 (vision/taste) → Phase 5 (write).
- If gate failed: emit mode-appropriate refusal (<post-mvp-refusal-template> or <pre-mvp-refusal-template>). Do NOT proceed to Phase 1.
- In pre-MVP mode with degraded_inputs: synthesize what you can, mark affected sections LOW confidence or CANNOT-SYNTHESIZE with `what_would_raise_confidence` notes. Do NOT fabricate. Cap constitution at `status: partial`. Set `phase: pre-mvp`, `requires_research_wave: true`, `max_status_until_refinement: partial` in frontmatter.
- If prior constitution was pre-MVP AND now degraded_inputs is empty (research wave completed): explicitly announce "Transitioning pre-MVP → post-MVP" at Phase 2, re-synthesize previously-LOW sections with real data, flip frontmatter.
- Absolute: no open-ended "what is your mission?" / "who is your user?" / "what are your values?" / "how do you feel about <competitor>?" questions. Every section synthesized from data, presented for founder validation.
- Blank-slate questions permitted:
  - Post-MVP mode: Phase 4, ≤ 3 total (personal why, aesthetic compass, 5-year aspiration).
  - Pre-MVP mode: Phase 4, ≤ 4 total (above + "name first 10 intended users by role/archetype/channel" as research proxy).
- 3-revision ceiling in Phase 3. If not converged after 3 rounds, raise research_insufficient flag.
- Do NOT announce mode activation (depth or pre-mvp) as preamble — founder already opted in via flag/keyword.
```

The wrapper produces NO user-facing output between invocation and agent's first message. The agent's first message is EITHER the hard-stop refusal (if gate failed) OR the full Phase 2 hypothesis block (if gate passed).

## Phase 2 — Post-Completion (optional)

After the agent completes (constitution written OR hard-stop refusal delivered), the wrapper itself produces NO additional output. The agent's terminal message is the summary.

If the user needs a reminder of next steps, they can ask; the wrapper does not proactively narrate.

</Protocol>

<Input_Contract>
Session flags (optional, mutually exclusive):
- `--session1` — force first-pass synthesis
- `--session2` — force refinement (agent presents deltas against prior constitution)
- `--refine` — open-ended refinement

Phase flags (optional, orthogonal to session flags):
- `--pre-mvp` (canonical) / `--premvp` / `--early-stage` (aliases) — explicit opt-in to pre-MVP mode. Relaxes gate: only vision source is hard-required; competitors and research are soft (mark affected sections LOW confidence or CANNOT-SYNTHESIZE). Caps constitution status at `partial`. Adds Q4 research proxy in Phase 4.
- `--post-mvp` — explicit opt-out from pre-MVP mode; relevant when prior constitution has `phase: pre-mvp` but founder wants to force post-MVP posture (e.g., treating thin inputs as an error rather than expected state).
- Default: `post-mvp`. Pre-MVP mode does NOT auto-infer — requires explicit flag or natural-language keyword.

Depth flags (optional, orthogonal to session AND phase flags — compose freely):
- `--deep` — synthesize extended hypothesis set (10 categories instead of 5)
- `--philosophy` — alias for `--deep`
- `--depth` — alias for `--deep`
- `--shallow` — explicit opt-OUT from depth posture when prior constitution has `depth_mode: true`; ignored if no prior depth constitution

Depth Mode adds 5 additional hypothesis categories to the synthesis: Value Ladders (feature → belief chains), Productive Tensions (held contradictions), Aspirational Archetype Seed (feeds brand-architect), Semiotic Stance (residual/dominant/emergent triplet), Antagonism Map (per-competitor deliberate-not). All still SYNTHESIZED from data, not interviewed.

Pre-MVP Mode relaxes data requirements but does NOT weaken method — synthesis-first discipline holds, sections just get LOW confidence markers instead of being skipped or faked. In pre-MVP, the constitution is explicitly hypothesis-grade (capped at `status: partial`), transitions to evidence-grade on session 2 after research wave.

No positional args. The agent reads compact context from `.omc/ideas/current.md` or index files, `.omc/specs/current.md` or index files, compact competitor/research/brand digests, `.omc/constitution.md`, and explicit source paths selected by index pointers.
</Input_Contract>

<Output>
- `.omc/constitution.md` — written by agent after Phase 3 convergence + Phase 4 vision/taste capture. Contains all validated hypotheses with inline `<!-- source: -->` citations. Frontmatter: `status`, `phase`, `depth_mode`, `synthesis_method: research-driven`, `sessions`, `research_sources`, `degraded_inputs`, `confidence_summary`, `requires_research_wave`, `max_status_until_refinement`, `revision_count`, `research_insufficient`.
- Agent's terminal message: ≤ 80 words, file-written + next-step + handoff. No ceremony.
- **OR** agent's hard-stop refusal message (if Phase 0 gate failed): structured list of missing inputs + remediation sequence. Mode-appropriate template (post-MVP vs pre-MVP). No constitution written.
</Output>

<Failure_Modes_To_Avoid>
- **Soft-gating when research is missing.** The wrapper must enforce the hard-stop. "Competitor data is thin, but let's start anyway" is explicitly the failure mode the synthesis-first redesign was built to prevent. If gate fails, the agent refuses — full stop.
- **Narrating Phase 0 gate results to the user in wrapper output.** The agent emits the refusal via its prompt; the wrapper does not produce a parallel commentary. Silent gate check, agent-owned refusal delivery.
- **Narrating Phase 0 context ingestion to the user.** "I've read your competitors and research — here's what I found" is exactly the preamble that buries the agent's first message. Silent reads only; the synthesis quality shows in the SPECIFICITY of the hypothesis block.
- **Invoking brand-steward as a teammate through a team relay.** That creates a proxy-UX where the user talks to a middleman. Use direct Task invocation only.
- **Announcing session mode to the user.** Session detection is internal. The agent knows the mode from the directive.
- **Announcing depth-mode activation to the user.** User passed `--deep` explicitly — the first message they see should already be the Phase 2 hypothesis block, not "ok, entering depth mode." Ceremony defeats the opt-in.
- **Adding post-completion summary.** The agent's terminal message is the summary. Anything from the wrapper on top is noise.
- **Regressing to interview mode after Phase 0 gate passes.** If the wrapper lets the agent fall into "let me ask you about your values" mode, the entire synthesis-first design is defeated. Directive text must reinforce: no open-ended questions outside Phase 4's 3 permitted items.
- **Duplicating agent-level keyword detection in the wrapper.** The agent scans the user's first message for natural-language depth triggers. The wrapper only handles the explicit flag case. Adding keyword-detection in the wrapper creates two detection layers that can disagree.
- **Silently dropping `--deep` flag when args also include a session flag.** Flags compose; `--session1 --deep` means "first session with extended hypothesis set." Do not treat them as mutually exclusive.
- **Converting `--shallow` into a "skip depth output" signal for non-depth constitutions.** `--shallow` is ONLY meaningful when prior constitution has `depth_mode: true`; it's an opt-out from continuing depth posture. Ignored otherwise.
- **Auto-inferring pre-MVP mode from absence of research.** Pre-MVP is explicit opt-in only. If research is missing and user did NOT pass `--pre-mvp`, the correct behavior is post-MVP hard-stop (which itself recommends --pre-mvp in the refusal). Silent mode-switching creates surprising behavior.
- **Accepting `--pre-mvp` when `.omc/research/` + `.omc/competitors/` are both populated.** If the project already has full data, `--pre-mvp` is likely a mistake. Agent should flag the contradiction in its first message and ask for confirmation before proceeding in pre-MVP posture — do not silently relax the gate when it would otherwise pass strictly.
- **Dropping `--pre-mvp` when combined with session flags.** `--session1 --pre-mvp` and `--session2 --pre-mvp` are both valid compositions. Flags compose; do not treat phase flag as mutually exclusive with session flag.
- **Ignoring pre-MVP → post-MVP transition on session 2.** When prior constitution has `phase: pre-mvp` AND current `.omc/research/` + `.omc/competitors/` now meet post-MVP thresholds, the wrapper must pass this transition signal to the agent ("prior_phase: pre-mvp, current_gate: post-mvp-eligible") so the agent emits the explicit transition announcement in Phase 2.
- **Validating prerequisites too aggressively.** Session 2 without competitors is fine — the agent will flag it in conversation, not fail at wrapper level.
- **Enumerating archives in the wrapper.** The wrapper should pass compact context paths, not load `.omc/ideas/**`, `.omc/specs/**`, `.omc/competitors/**`, `.omc/research/**`, or `.omc/brand/**`.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Delegates to `oh-my-claudecode:brand-steward` agent via direct Task invocation.

**Dependency ordering (post-MVP path — full gate):**
  1a. `/deep-interview "<vague problem>"` — if the problem is not yet crystallized, use Socratic dialog to formulate (produces `.omc/specs/`).
  1b. `/ideate "<problem statement>"` — if the problem is stated clearly and you want divergent exploration + scored hypotheses + red-team (produces `.omc/ideas/`).
  (at least ONE of 1a/1b required)
  2. `/competitor-scout --auto` — scout top 5–10 competitors (≥3 required — HARD)
  3. `/ux-researcher` — synthesize user research from interviews / proxies (≥1 required — HARD)
  4. `/brand-steward [--deep]` — synthesize constitution from above
  5. `/brand-architect` — full brand system (archetype + grammar); reads constitution
  6. (product usage / additional research accumulates)
  7. `/brand-steward --session2 [--deep]` — refinement with deltas

**Dependency ordering (pre-MVP path — relaxed gate):**
  1a/1b. Same as above — vision source (deep-interview OR ideate) is HARD
  2. `/competitor-scout --auto` — RECOMMENDED but not required (<3 dossiers → LOW confidence on antagonism-map / archetype seed / semiotic stance)
  3. `/ux-researcher` — RECOMMENDED but not required (absent → LOW confidence on target user / tone)
  4. `/brand-steward --pre-mvp [--deep]` — synthesize hypothesis-grade constitution
  5. (build MVP; first 10-20 users come in)
  6. `/ux-researcher` — wave 1 from real users (produces `.omc/research/`)
  7. `/competitor-scout --auto` — expand to ≥3 dossiers if not already
  8. `/brand-steward --session2 [--deep]` — auto-transitions pre-MVP → post-MVP, re-synthesizes previously-LOW sections with real data, promotes status to `partial` or `complete`
  9. `/brand-architect` (or refine if already ran)

- Pre-MVP mode recommendation: if product is not yet built, no users exist to research, and you want to proceed with brand framing to direct the first build — use `--pre-mvp`. Constitution is hypothesis-grade until session 2 with real data. Every LOW section includes an actionable data-gap note.
- Depth mode recommendation: founders in competitive niches (where generic positioning is fatal), or founders who self-assess as giving surface answers to strategic questions, benefit from extended hypothesis set. 10 categories instead of 5. Compose with `--pre-mvp` if applicable: `/brand-steward --pre-mvp --deep`.
- Related: `/brand-architect` (reads constitution's Aspirational Archetype Seed + Semiotic Stance as seed for full 12-archetype analysis + brand grammar), `/product-strategist` (per-feature gate using anti-goals this skill produces).
- Synthesis-first discipline is enforced in the AGENT prompt. Wrapper stays minimal: gate check, flag parsing, directive formation, Task invocation. Protocol changes (new hypothesis categories, new phases, new modes) happen in one place — the agent prompt — not in this wrapper.
</Integration_Notes>

---
name: brand-steward
description: Slash-wrapper for the brand-steward agent — invokes research-driven SYNTHESIS of brand identity (mission, target user, anti-goals, tone, scope). Reads .omc/ideate/ + .omc/competitors/ + .omc/research/ and presents validated hypotheses for founder to judge. Hard-stop gate refuses to proceed without required research inputs. Opt-in depth mode via --deep adds value ladders, productive tensions, archetypal seed, semiotic codes, antagonism map as additional hypothesis categories. Founder is judge + source of vision/taste, not source of answers
argument-hint: "[--session1 | --session2 | --refine] [--deep | --philosophy | --depth | --shallow]"
level: 4
---

# Brand Steward Skill

Minimal slash-wrapper for the `brand-steward` agent. The wrapper enforces the research-completeness gate (hard-stop), detects depth-mode flags, and hands off to the agent via direct Task invocation with a synthesis-first directive. All brand-identity content is SYNTHESIZED from research / competitors / ideate data — the founder validates hypotheses, does not generate them from scratch.

## Usage

```
/oh-my-claudecode:brand-steward                      # auto-detect session, standard synthesis
/brand-steward --session1                            # first pass, standard synthesis
/brand-steward --session2                            # refinement pass (delta against prior constitution)
/brand-steward --refine                              # open-ended refinement
/brand-steward --deep                                # auto-detect session, depth synthesis (10 hypothesis categories)
/brand-steward --session1 --deep                     # first pass with extended hypothesis set
/brand-steward --session2 --philosophy               # refinement with extended hypothesis set (alias for --deep)
/brand-steward --session2 --shallow                  # refine depth-mode constitution in standard posture (opt-out)
```

Session flags and depth flags compose independently. `--deep`, `--philosophy`, and `--depth` are synonyms. Depth mode can also be activated via natural-language triggers in the user's first message ("глубинный режим", "сложная философия", "боюсь поверхностных ответов", "deep mode", "go deep") — agent detects these itself when no flag is present. The wrapper only parses explicit flags; natural-language detection lives in the agent.

<Purpose>
Single command that invokes `brand-steward` agent to do research-driven synthesis of product identity. The wrapper is intentionally thin: it enforces the research-gate, detects session + depth modes, and invokes the agent. Everything else — reading data, synthesizing hypotheses, presenting for validation, revising on feedback, capturing vision/taste — happens inside the agent dialog directly with the user. The wrapper produces NO user-facing output except the hard-stop refusal when the research-gate fails.
</Purpose>

<Use_When>
- Founding phase, research already collected — `.omc/ideate/`, `.omc/competitors/` (≥3 dossiers), `.omc/research/` (≥1 synthesis artifact) are in place and you want the first constitution.
- Refinement phase (session 2) — after 10–14 days of accumulated product data, re-synthesize and present deltas against existing constitution.
- Material market shift — new competitor dossier, research wave, regulatory change — that may invalidate existing anti-goals / positioning.
- Product strategy pivot — when ideate has new vision material and prior constitution is now stale.
</Use_When>

<Do_Not_Use_When>
- Research inputs are missing or thin. The skill will hard-stop and recommend running `/ideate`, `/competitor-scout`, `/ux-researcher` first. Do NOT attempt to "just brainstorm" constitution via this skill — it is explicitly designed to refuse that mode.
- You need archetype / visual system / grammar — use `/brand-architect` (reads this skill's output; does full 12-archetype analysis).
- You need specific copy polish — use copywriter agent directly.
- Single-feature evaluation — use `/product-strategist`.
</Do_Not_Use_When>

<Protocol>

## Phase 0 — Research-Completeness Gate + Session + Depth Detection

Read silently (no output to user):
1. `.omc/ideate/` — exists? count of non-empty `.md` files?
2. `.omc/competitors/` — exists? count of dossier files?
3. `.omc/research/` — exists? count of synthesis artifacts (persona, pain-point report, JTBD analysis)?
4. `.omc/constitution.md` — exists? note `status` field + existing `depth_mode` frontmatter if present.
5. `.omc/brand/` — exists? (informs alignment if brand-architect already ran)

**Research-gate (hard-stop enforcement):**
- If `.omc/ideate/` missing OR empty → FAIL GATE
- If `.omc/competitors/` missing OR has fewer than 3 dossiers → FAIL GATE
- If `.omc/research/` missing OR empty → FAIL GATE

**If gate FAILS**, the wrapper does NOT invoke the agent. Instead, the wrapper passes a `gate_failure: <details>` directive to the agent via Task tool so the agent emits its structured refusal (documented in its `<Synthesis_Protocol>` Phase 0). The refusal lists what's missing, why each input is required, and the recommended remediation sequence (`/ideate`, `/competitor-scout`, `/ux-researcher`). Session terminates. No constitution written.

The hard-stop is intentional and non-negotiable: synthesis-first design depends on having data to synthesize from. Falling back to interview mode when data is missing reproduces the exact failure mode this agent was redesigned to prevent.

**If gate PASSES**, proceed to session + depth detection.

**Session mode** (from args + context):
- `--session1` flag OR constitution absent OR `status: draft` with no fills → session 1.
- `--session2` flag OR (`status: partial` AND this is not a first invocation) → session 2.
- `--refine` → open-ended refinement.

**Depth mode** (orthogonal to session mode):
- Any of `--deep`, `--philosophy`, `--depth` in args → `depth_mode: true`.
- `--shallow` flag → `depth_mode: false` (explicit opt-out; relevant when prior constitution has `depth_mode: true` but founder wants standard posture for this session).
- If no depth flag AND prior `.omc/constitution.md` has `depth_mode: true` AND no `--shallow` → `depth_mode: continue` (maintain depth posture).
- If no depth flag AND no prior depth constitution → `depth_mode: false` (standard).
- Natural-language detection in the user's first message (e.g., "глубинный режим") is handled by the AGENT, not the wrapper. The wrapper only parses explicit flags.

## Phase 1 — Direct Invocation with Synthesis Directive

Invoke `oh-my-claudecode:brand-steward` agent via Task tool (NOT as a teammate, NOT via SendMessage, NOT via TeamCreate). The agent runs in a direct conversational channel with the user.

**Invocation directive** (passed in Task prompt):

```
Session mode: [1 | 2 | refine]
Depth mode: [true | false | continue]
Gate status: [passed | failed-with-<details>]
Research sources present:
  - ideate_files: <N>
  - competitor_dossiers: <N>
  - research_artifacts: <N>
Prior constitution: [absent | draft | partial | complete]
Prior brand artifacts: [absent | present]

Instructions:
- Execute Synthesis_Protocol per agent prompt.
- If gate passed: proceed Phase 1 (silent synthesis) → Phase 2 (hypothesis presentation) → Phase 3 (revision) → Phase 4 (vision/taste) → Phase 5 (write).
- If gate failed: emit structured refusal per agent's Phase 0 hard-stop template. Do NOT proceed to Phase 1.
- Absolute: no open-ended "what is your mission?" / "who is your user?" / "what are your values?" / "how do you feel about <competitor>?" questions. Every section synthesized from data, presented for founder validation.
- Only blank-slate questions permitted: Phase 4 (≤ 3 total — personal why, aesthetic compass, 5-year aspiration).
- 3-revision ceiling in Phase 3. If not converged after 3 rounds, raise research_insufficient flag.
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

Depth flags (optional, orthogonal to session flags — compose freely):
- `--deep` — synthesize extended hypothesis set (10 categories instead of 5)
- `--philosophy` — alias for `--deep`
- `--depth` — alias for `--deep`
- `--shallow` — explicit opt-OUT from depth posture when prior constitution has `depth_mode: true`; ignored if no prior depth constitution

Depth Mode adds 5 additional hypothesis categories to the synthesis: Value Ladders (feature → belief chains), Productive Tensions (held contradictions), Aspirational Archetype Seed (feeds brand-architect), Semiotic Stance (residual/dominant/emergent triplet), Antagonism Map (per-competitor deliberate-not). All still SYNTHESIZED from data, not interviewed. Method is identical; breadth of output is larger.

No positional args. The agent reads context from `.omc/ideate/`, `.omc/competitors/`, `.omc/research/`, `.omc/constitution.md`, `.omc/brand/` in its Phase 1.
</Input_Contract>

<Output>
- `.omc/constitution.md` — written by agent after Phase 3 convergence + Phase 4 vision/taste capture. Contains all validated hypotheses with inline `<!-- source: -->` citations. Frontmatter: `status`, `depth_mode`, `synthesis_method: research-driven`, `sessions`, `research_sources`, `revision_count`, `research_insufficient`.
- Agent's terminal message: ≤ 80 words, file-written + next-step + handoff. No ceremony.
- **OR** agent's hard-stop refusal message (if Phase 0 gate failed): structured list of missing inputs + remediation sequence. No constitution written.
</Output>

<Failure_Modes_To_Avoid>
- **Soft-gating when research is missing.** The wrapper must enforce the hard-stop. "Competitor data is thin, but let's start anyway" is explicitly the failure mode the synthesis-first redesign was built to prevent. If gate fails, the agent refuses — full stop.
- **Narrating Phase 0 gate results to the user in wrapper output.** The agent emits the refusal via its prompt; the wrapper does not produce a parallel commentary. Silent gate check, agent-owned refusal delivery.
- **Narrating Phase 0 context ingestion to the user.** "I've read your competitors and research — here's what I found" is exactly the preamble that buries the agent's first message. Silent reads only; the synthesis quality shows in the SPECIFICITY of the hypothesis block.
- **Invoking brand-steward as a teammate (TeamCreate + SendMessage relay).** That creates a proxy-UX where the user talks to a middleman. Use direct Task invocation only.
- **Announcing session mode to the user.** Session detection is internal. The agent knows the mode from the directive.
- **Announcing depth-mode activation to the user.** User passed `--deep` explicitly — the first message they see should already be the Phase 2 hypothesis block, not "ok, entering depth mode." Ceremony defeats the opt-in.
- **Adding post-completion summary.** The agent's terminal message is the summary. Anything from the wrapper on top is noise.
- **Regressing to interview mode after Phase 0 gate passes.** If the wrapper lets the agent fall into "let me ask you about your values" mode, the entire synthesis-first design is defeated. Directive text must reinforce: no open-ended questions outside Phase 4's 3 permitted items.
- **Duplicating agent-level keyword detection in the wrapper.** The agent scans the user's first message for natural-language depth triggers. The wrapper only handles the explicit flag case. Adding keyword-detection in the wrapper creates two detection layers that can disagree.
- **Silently dropping `--deep` flag when args also include a session flag.** Flags compose; `--session1 --deep` means "first session with extended hypothesis set." Do not treat them as mutually exclusive.
- **Converting `--shallow` into a "skip depth output" signal for non-depth constitutions.** `--shallow` is ONLY meaningful when prior constitution has `depth_mode: true`; it's an opt-out from continuing depth posture. Ignored otherwise.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Delegates to `oh-my-claudecode:brand-steward` agent via direct Task invocation.
- **Dependency ordering (enforced by hard-stop gate):**
  1. `/ideate` — founder vision dump (produces `.omc/ideate/`)
  2. `/competitor-scout --auto` — scout top 5–10 competitors (produces `.omc/competitors/` dossiers)
  3. `/ux-researcher` — synthesize user research from interviews / proxies (produces `.omc/research/`)
  4. `/brand-steward [--deep]` — synthesize constitution from all three (this skill)
  5. `/brand-architect` — full brand system (archetype + grammar); reads constitution
  6. (2 weeks of product usage / additional research)
  7. `/brand-steward --session2 [--deep]` — refinement with deltas
- Depth mode recommendation: founders in competitive niches (where generic positioning is fatal), or founders who self-assess as giving surface answers to strategic questions, benefit from extended hypothesis set. 10 categories instead of 5. Same hard-stop gate applies.
- Related: `/brand-architect` (reads constitution's Aspirational Archetype Seed + Semiotic Stance as seed for full 12-archetype analysis + brand grammar), `/product-strategist` (per-feature gate using anti-goals this skill produces).
- Synthesis-first discipline is enforced in the AGENT prompt. Wrapper stays minimal: gate check, flag parsing, directive formation, Task invocation. Protocol changes (new hypothesis categories, new phases) happen in one place — the agent prompt — not in this wrapper.
</Integration_Notes>

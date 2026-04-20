---
name: brand-steward
description: Slash-wrapper for the brand-steward agent — invokes strategic discovery interview for mission, target user, anti-goals, scope boundaries, tone hints. Conversational mode (one question per turn, no pre-menus, no numbered blocks). Opt-in depth mode via --deep for non-flat philosophy (laddering, forced antagonism, productive tension, archetypal seed, semiotic codes). Minimal wrapper — delegates to agent immediately
argument-hint: "[--session1 | --session2 | --refine] [--deep | --philosophy | --depth]"
level: 4
---

# Brand Steward Skill

Minimal slash-wrapper for the `brand-steward` agent. The wrapper does NO narration of context, NO pre-menus, NO teammate/SendMessage relay. It reads session state silently and hands off to the agent via a direct Task invocation with a session-mode directive. All interaction is between the user and the agent directly — in a conversational loop, one question per turn.

## Usage

```
/oh-my-claudecode:brand-steward                      # auto-detect session, standard mode
/brand-steward --session1                            # first pass, standard mode
/brand-steward --session2                            # refinement pass, standard mode
/brand-steward --refine                              # open-ended refinement
/brand-steward --deep                                # auto-detect session, DEPTH mode
/brand-steward --session1 --deep                     # first pass in depth mode (45–60 min interview)
/brand-steward --session2 --philosophy               # refinement pass in depth mode (alias for --deep)
```

Session flags and depth flags compose independently. `--deep`, `--philosophy`, and `--depth` are synonyms — any one activates depth mode. Depth mode can also be activated via natural-language keywords in the user's first message ("глубинный режим", "сложная философия", "боюсь поверхностных ответов", "deep mode", "go deep") — agent detects these itself when no flag is present.

<Purpose>
Single command that invokes `brand-steward` agent to conduct conversational brand discovery. Wrapper is intentionally thin: it detects the session mode and invokes the agent — no pre-amble, no context narration, no menus. The agent owns the dialogue start-to-finish.
</Purpose>

<Use_When>
- First day of product — need constitution foundation.
- After 10–14 days of scout + ideate + partner data — refine anti-goals with accumulated evidence.
- Material market shift (new competitor, regulatory change) that may invalidate anti-goals.
- Product strategy pivot.
</Use_When>

<Do_Not_Use_When>
- You need archetype / visual system / grammar — use `/brand-architect` (different concern).
- You need specific copy polish — use copywriter agent directly.
- Single-feature evaluation — use `/product-strategist`.
</Do_Not_Use_When>

<Protocol>

## Phase 0 — Silent Session + Depth Detection

Read silently (no output to user):
1. `.omc/constitution.md` if exists — note `status` field AND existing `depth_mode` frontmatter (if present).
2. Presence of `.omc/competitors/` and count of dossiers.
3. Presence of `.omc/research/` and count of synthesis artifacts.

**Session mode** (from args + context):
- `--session1` flag OR constitution absent OR `status: draft` with no fills → session 1.
- `--session2` flag OR (`status: partial` AND competitors≥3 AND research≥1) → session 2.
- `--refine` → open-ended refinement.

**Depth mode** (orthogonal to session mode, can combine):
- Any of `--deep`, `--philosophy`, `--depth` in args → depth_mode: true.
- If no depth flag in args, depth_mode defaults to false — BUT the agent itself will scan the user's first message for natural-language depth triggers ("глубинный режим", "сложная философия", "не поверхностно", "боюсь поверхностных ответов", "deep mode", "go deep", etc.) and switch to depth mode if found. The wrapper does not need to duplicate that detection; it only handles the explicit flag case.
- If `.omc/constitution.md` exists with `depth_mode: true` in frontmatter AND user invokes without depth flag, treat as session in LEGACY-depth state — pass depth_mode: continue in the directive so the agent maintains depth posture when refining depth-mode sections. User can opt out of depth posture by passing `--shallow` (see Input_Contract).

Prerequisites check: Phase 0 does NOT gate on absent context. If competitors are missing for session 2, brand-steward itself will ask the user whether to proceed or run competitor-scout first. The wrapper does not over-validate. Same for depth mode: if a user passes `--deep` but no `.omc/competitors/` exists, the agent will flag this in conversation (Forced Antagonism pass depends on competitor data) rather than failing at the wrapper level.

## Phase 1 — Direct Invocation

Invoke `oh-my-claudecode:brand-steward` agent via Task tool (NOT as a teammate, NOT via SendMessage, NOT via TeamCreate). The agent runs in a direct conversational channel with the user.

Invocation directive:
- Session mode: 1 | 2 | refine.
- Depth mode: true | false | continue (true when `--deep`/`--philosophy`/`--depth` flag present; continue when constitution has prior `depth_mode: true` frontmatter and user did not pass `--shallow`; false otherwise).
- Available context paths (agent reads them directly in its Phase A): constitution, competitors, research, brand.
- Enforcement: conversational discipline per agent Investigation_Protocol (≤80 words first message, one question per turn, no pre-menus, no numbered blocks). In depth mode, per-turn reply cap is 160 words to accommodate framing before archetypal/semiotic questions; one-question-per-turn discipline is still absolute.

When passing `depth_mode: true` to the agent, the wrapper includes an explicit line in the directive: "Depth Mode activated by explicit flag. Open Phase B with a depth-technique question (prefer Laddering anchored on a research-file pain quote if .omc/research/ exists, else Productive Tension on mission). Do NOT announce 'depth mode activated' as preamble — user already opted in."

The wrapper produces NO user-facing output between invocation and agent's first message. Do not announce context, do not narrate setup, do not pre-menu language choices — the agent handles all of this in dialogue. The wrapper does NOT announce depth-mode activation either — the user's flag was explicit opt-in; ceremony is noise.

## Phase 2 — Post-Completion (optional)

After the agent completes (constitution written + terminal message delivered), the wrapper itself produces NO additional output. The agent's terminal message is the summary.

If the user needs a reminder of next steps, they can ask; the wrapper does not proactively narrate.

</Protocol>

<Input_Contract>
Session flags (optional, mutually exclusive):
- `--session1` — force first-pass interview
- `--session2` — force refinement pass
- `--refine` — open-ended refinement

Depth flags (optional, orthogonal to session flags — compose freely):
- `--deep` — activate Depth Mode (the canonical form)
- `--philosophy` — alias for `--deep`
- `--depth` — alias for `--deep`
- `--shallow` — explicit opt-OUT from depth posture when refining a constitution that has `depth_mode: true` in frontmatter; ignored if constitution is non-depth

Depth Mode triggers the agent's five-pass protocol (laddering, forced antagonism, productive tension, archetypal seed, semiotic codes). Interview grows from ~15 min to ~45–60 min in exchange for non-flat philosophy. See the brand-steward agent's `<Depth_Mode_Protocol>` section for the full mechanic.

No positional args. The agent reads context from `.omc/` in its own Phase A.
</Input_Contract>

<Output>
- `.omc/constitution.md` — updated by agent; `status` field advanced when evidence supports promotion.
- Agent's in-conversation synthesis message (no wrapper-generated summary).
</Output>

<Failure_Modes_To_Avoid>
- **Narrating Phase 0 context ingestion to the user.** "I've read your competitors and research — here's what I found" is exactly the pre-amble that buries the agent's first question. Silent reads only.
- **Pre-menu for language choice.** Language preference is a dialogue question the agent asks when relevant, not a wrapper-side selection.
- **Invoking brand-steward as a teammate (TeamCreate + SendMessage relay).** That creates a proxy-UX where the user talks to a middleman. Use direct Task invocation only.
- **Announcing session mode to the user.** Session detection is internal. The agent knows the mode from the directive.
- **Announcing depth-mode activation to the user.** User passed `--deep` explicitly — the first message they see should already be a depth-technique question, not "ok, entering depth mode." Ceremony defeats the opt-in.
- **Adding post-completion summary.** The agent's terminal message is the summary. Anything from the wrapper on top is noise.
- **Validating prerequisites too aggressively.** Session 2 without competitors is fine — the agent will flag it in conversation, not fail at wrapper level. Same for `--deep` without competitors: Forced Antagonism pass will be skipped with a note, not rejected at the wrapper.
- **Duplicating agent-level keyword detection in the wrapper.** The agent scans the user's first message for natural-language depth triggers. The wrapper only handles the explicit flag case. Adding keyword-detection in the wrapper creates two detection layers that can disagree.
- **Silently dropping `--deep` flag when args also include a session flag.** Flags compose; `--session1 --deep` means "first session in depth mode." Do not treat them as mutually exclusive.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Delegates to `oh-my-claudecode:brand-steward` agent via direct Task invocation.
- Recommended sequence (standard): `/competitor-scout --new-only` → `/brand-steward --session1` → `/brand-architect` → (2 weeks of product work) → `/brand-steward --session2`.
- Recommended sequence (depth — for founders who self-assess as giving surface answers, or for competitive niches where generic positioning is fatal): `/competitor-scout --new-only` → `/brand-steward --session1 --deep` → `/brand-architect` (reads depth-mode constitution, skips redundant archetype/semiotic discovery via `brand_architect_depth_seeded` gate) → (2 weeks) → `/brand-steward --session2 --deep` for refinement.
- Related: `/brand-architect` (expressive counterpart — archetype + grammar; reads depth-mode Aspirational Archetype Hint as seed for full 12-archetype analysis), `/product-strategist` (per-feature gate using anti-goals this produces).
- The conversational discipline is enforced in the AGENT prompt, not in this wrapper. Wrapper stays minimal so future changes to conversation shape happen in one place. Depth-mode protocol similarly lives entirely in the agent — the wrapper's only depth responsibility is flag parsing and directive-passing.
</Integration_Notes>

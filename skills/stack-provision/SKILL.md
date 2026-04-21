---
name: stack-provision
description: Stack-driven skill provisioner — reads an ADR (or explicit stack list), discovers skills across skills.sh / Claude plugin marketplace / whitelisted GitHub orgs, generates drafts for coverage gaps, gates install behind a human review, and writes a provenance manifest
argument-hint: "[ADR-path | \"tech1, tech2, ...\"] [--no-generate] [--dry-run] [--aspects=<list>]"
level: 4
---

# Stack Provision Skill

Orchestrates discovery, review, and installation of Claude Code skills that match a project's chosen technology stack. Converts a stack decision (ADR) into an installed set of per-technology best-practice skills, with a mandatory human-review gate before any install and a provenance manifest for every provisioned artifact.

## Usage

```
/oh-my-claudecode:stack-provision <ADR-path>
/oh-my-claudecode:stack-provision "<comma-separated tech list>"
/stack-provision .omc/decisions/2026-04-20-stack-myapp.md
/stack-provision "next.js, supabase, tailwind, playwright"
/stack-provision "next.js, supabase" --no-generate       # discover only, no draft generation
/stack-provision "next.js, supabase" --dry-run           # full pipeline without installing
/stack-provision "next.js" --aspects=testing,security    # scope aspects
```

### Examples

```
/stack-provision .omc/decisions/2026-04-20-stack-knitapp.md
/stack-provision "remix, prisma, postgres, vitest" --aspects=testing,performance
/stack-provision "kotlin, spring-boot" --no-generate
```

### Flags

- `--no-generate` — skip Phase 3 gap-fill generation. Phase 4 review receives only discovered (public) candidates.
- `--dry-run` — run the full pipeline through Phase 4 review but emit install commands as output instead of executing them. Useful for CI or conservative shops.
- `--aspects=<list>` — narrow coverage aspects. Default aspects: `best-practices,testing,security,performance,patterns`. Override example: `--aspects=testing,security`.
- `--skip-skills-sh` — exclude skills.sh from discovery (e.g., offline or air-gapped environments).
- `--skip-plugin-marketplace` — exclude Claude Code plugin marketplace from discovery.
- `--config=<path>` — path to a custom provisioning config (default: `.omc/stack-provision.config.md` if present, else baked-in defaults).

<Purpose>
Convert a chosen stack into an installed set of skills and best-practice packs in a repeatable, auditable way. Enforces non-skippable human review before any filesystem write, a priority-ordered source model (skills.sh first per project preference), coverage analysis across named aspects (best-practices / testing / security / performance / patterns), gap-fill generation when no public skill covers a slot, and a provenance manifest that makes every install reversible. Halts at HARD STOPs (no discovery tool, zero coverage for a critical tech after full sweep, all candidates rejected) and reports the reason plus remediation.
</Purpose>

<Use_When>
- A stack ADR has just been produced (via `/ralplan` or `architect`) and the team needs the per-tech skill set installed.
- A new technology is being adopted mid-project and its best-practice coverage is missing.
- A coverage audit is needed to detect which installed skills are stale (last update >6mo) and which gaps persist.
- Migrating a project between stacks and the skill set must be re-provisioned (`--no-generate` for a pure swap).
- Onboarding a new contributor and their local `~/.claude/skills/omc-learned/` should mirror the project stack.
</Use_When>

<Do_Not_Use_When>
- The stack has not been decided yet — run `/ralplan` for stack selection first; this skill is the follow-on, not the decision.
- You want to manually install a single known skill — use `/plugin install <slug>@<marketplace>` or `npx skillsadd <owner/repo>` directly.
- You want to create a brand-new skill from a session workflow — use `/oh-my-claudecode:skillify` instead.
- Air-gapped environment with no web access — this skill cannot function without discovery tools; no offline mode.
- Production-critical auto-install contexts (CI pipelines, build systems) — the human gate is non-negotiable; use `--dry-run` for CI output.
</Do_Not_Use_When>

<Why_This_Exists>
OMC can choose a stack (`/ralplan` + ADR), implement features on that stack (`/product-pipeline`), and maintain brand coherence across outputs (`brand-architect`). The missing link is between stack decision and skill derivation: once a stack is chosen, the set of needed best-practice skills is *causally determined* by the stack, yet there is no mechanism that turns that derivation into installed artifacts.

Without this skill, users face a choice that existing tooling does not solve well:
1. Manually browse skills.sh / plugin marketplaces and install individually — slow, error-prone, inconsistent across team members.
2. Let the LLM "just know" the best practices — unreliable, unverified, no provenance, drifts over time.
3. Write every best-practice skill from scratch — duplicates community work, wastes context.

`stack-provision` formalizes the derivation as a pipeline: stack decision → discovered candidates per (tech × aspect) → coverage analysis → drafts for gaps → human review → installed skill set → provenance manifest. The manifest makes the set reversible, auditable, and reproducible across team members.

The skill is also a **trust-boundary enforcement layer**. Skills are prompts; auto-installing arbitrary prompts from the internet is a prompt-injection surface. By requiring a human review gate with SKILL.md preview and red-flag annotations (repo age, star count, single-contributor) before any filesystem write, the skill turns a dangerous operation into a controlled one.
</Why_This_Exists>

<Pipeline_Phases>

## Phase 0 — Foundation & Input Parsing

**Agent:** stack-provision orchestrator (single invocation)
**Input:** Skill argument (ADR path or comma-separated tech list), flags, optional `.omc/stack-provision.config.md`
**Output:** `.omc/provisioned/contract/YYYY-MM-DD-<slug>-contract.md`

**Protocol:**
1. Verify at least one discovery tool is available: `WebFetch`, `WebSearch`, or `mcp__linkup__linkup-search`. If none → HARD STOP.
2. Verify installer tools: `command -v npx` (for skills.sh), Claude Code plugin subsystem (`/plugin install` availability via session context). Record which install channels are usable.
3. Parse the skill argument:
   - If argument is a path matching `.omc/decisions/**.md` → read file, extract stack list from the `## Decision` or `## Chosen Stack` section. If that section is absent, HARD STOP with: "ADR format unrecognized. Expected a `## Decision` section listing the stack technologies."
   - Else treat argument as a comma-separated tech list. Split, trim, normalize (lowercase, strip version pins, e.g. "Next.js 14" → "next.js").
4. Load config: if `.omc/stack-provision.config.md` exists, parse whitelisted orgs, generation policy, aspect defaults. Else use baked-in defaults (see `<Default_Config>` section).
5. Determine aspect coverage matrix: `stack_list × aspects_requested`. Each cell is one discovery slot. Example: 4 techs × 5 aspects = 20 slots.
6. Write Provisioning Contract to `.omc/provisioned/contract/YYYY-MM-DD-<slug>-contract.md`. The contract records: stack, aspects, sources-enabled, install channels available, flags applied.

**HARD STOP:** No discovery tool available. Remediation: enable WebFetch / WebSearch / linkup MCP.
**HARD STOP:** Empty stack after parsing. Remediation: supply non-empty ADR section or explicit tech list.
**HARD STOP:** ADR file referenced but not readable. Remediation: verify path, permissions.

---

## Phase 1 — Per-Tech Parallel Discovery

**Agents:** `document-specialist` × N (one invocation per tech, parallel via `/team`)
**Input:** Provisioning Contract + per-tech aspect matrix
**Output:** Per-tech candidate manifests at `.omc/provisioned/candidates/YYYY-MM-DD-<tech>.md`

**Protocol:**
1. Start a current OMC `/team` session or CLI-first `omc team ...` run with one `document-specialist` worker per technology. Do not use deprecated MCP team-runtime calls.
2. Assign each worker this directive:
   ```
   Discover skill candidates for technology: <tech>
   Aspects to cover: <aspect list>
   Sources (in priority order):
     1. skills.sh — query site (e.g., https://skills.sh then search for "<tech>"). Return matching owner/repo entries with install count, last updated, description.
     2. Claude Code plugin marketplace — query via WebFetch of claude-plugins.dev or equivalent index. Return plugin slugs with marketplace references.
     3. Whitelisted GitHub orgs (from contract): for each org, WebFetch `https://github.com/<org>` repo list filtering by topic/keyword matching <tech>. Return repo URLs with stars, last commit, contributor count.

   For each candidate, produce a record:
     - source: skills.sh | plugin-marketplace | github-<org>
     - ref: owner/repo OR plugin-slug@marketplace
     - install_cmd: exact install command
     - title: human-readable name
     - description: one-line summary
     - install_count: integer OR null
     - stars: integer OR null
     - last_updated: date OR null
     - contributors: integer OR null
     - url: canonical URL
     - aspect_hint: which of our aspects this covers (best-effort guess)
     - red_flags: list of any detected issues (age <30d, stars <10, single-contributor, last commit >6mo, unknown publisher)

   Do NOT install. Do NOT write SKILL.md files. Discovery only.
   Write findings to .omc/provisioned/candidates/YYYY-MM-DD-<tech>.md
   ```
3. Run workers in parallel. Each `document-specialist` writes its candidate file.
4. Orchestrator waits for all worker results, then merges candidates into a unified table per (tech × aspect).

**HARD STOP:** Zero candidates across all sources for a tech marked `critical: true` in the config AND `--no-generate` is set. Remediation: either remove `--no-generate` (fall through to Phase 3 generation), supply additional sources via config, or remove the tech from the stack.

**Soft warning (proceeds):** Tech has <1 candidate but generation is enabled — logged, Phase 3 will fill the gap.

---

## Phase 2 — Coverage Analysis

**Agent:** stack-provision orchestrator (single invocation)
**Input:** All Phase 1 candidate manifests
**Output:** `.omc/provisioned/coverage/YYYY-MM-DD-<slug>-matrix.md`

**Protocol:**
1. Build a coverage matrix: rows = aspects, columns = techs, cell = best candidate or `GAP`.
2. "Best candidate" selection per cell, in this order:
   - Highest install count (if skills.sh source).
   - Highest star count + most recent commit (if GitHub source).
   - Official marketplace entries win ties.
   - Entries with red flags are downranked (not excluded — surfaced in review).
3. For each `GAP` cell, note whether generation is enabled (`--no-generate` disables it).
4. Compute summary: total cells, filled / gap / to-generate.
5. Write matrix report. Example cell: `next.js × testing → skills.sh:vercel-labs/next-testing-patterns (2.4k installs, no red flags)`.

**HARD STOP:** None. Analytical phase only; gaps are data, not failures.

---

## Phase 3 — Gap-Fill Generation (optional)

**Agents:** `document-specialist` × N gaps (parallel) + `writer` for skill-draft formatting
**Input:** Coverage matrix (gaps subset) + constitution.md (for tone/format consistency)
**Output:** Draft SKILL.md files at `.omc/provisioned/drafts/YYYY-MM-DD-<tech>-<aspect>.md`

**Skip conditions:**
- `--no-generate` flag is set — skip phase entirely, gaps remain as gaps.
- No gaps detected after Phase 2.

**Protocol:**
1. For each gap cell, run a `document-specialist` worker through the current `/team` or CLI-first `omc team ...` runtime with directive:
   ```
   Produce canonical <aspect> guidance for <tech>.
   Pull from: official documentation, high-signal community standards.
   Required output sections:
     - Canonical patterns (with code examples if applicable)
     - Top 3 anti-patterns to avoid
     - Recommended libraries / tools (with one-line rationale each)
     - Testing / verification conventions
     - Breaking changes / deprecations in last 12 months
   Cite every source URL with retrieval date.
   ```
2. For each completed research bundle, invoke `writer` (or inline formatting) to produce a draft SKILL.md with:
   - YAML frontmatter: `name`, `description`, `provenance: generated`, `unvalidated: true`, `sources: [...]`, `generated_date: YYYY-MM-DD`, `covers: "<tech>/<aspect>"`
   - Body: structured from the research bundle.
3. Write to `.omc/provisioned/drafts/YYYY-MM-DD-<tech>-<aspect>.md` (NOT `~/.claude/skills/`).
4. Drafts carry the `unvalidated: true` flag permanently until the user manually promotes them by removing the flag.

**HARD STOP:** `document-specialist` returned empty or explicitly failed for ALL gaps AND there were no public candidates. Skill cannot provide coverage. Report: "No public skills and generation failed for <techs>. Remediation: check discovery tool connectivity; or install manually; or remove aspect from scope."

---

## Phase 4 — Human Review Gate (MANDATORY)

**Agent:** stack-provision orchestrator (single invocation, interactive)
**Input:** Coverage matrix + all candidate manifests + Phase 3 drafts (if any)
**Output:** `.omc/provisioned/review/YYYY-MM-DD-<slug>-decisions.md`

**Protocol:**
1. Present a single unified review surface organized by tech, then by aspect, in this format:

   ```
   Stack Provisioning Review — <stack slug>
   ================================

   ## Tech: next.js

   ### best-practices
   [1] skills.sh   vercel-labs/nextjs-best-practices   (2.4k installs, updated 14d ago)
       URL: https://github.com/vercel-labs/nextjs-best-practices
       Description: Canonical Next.js 14+ patterns for App Router and Server Components
       Red flags: none
       Install: npx skillsadd vercel-labs/nextjs-best-practices
       --- SKILL.md preview (first 30 lines) ---
       [preview content]

   ### testing
   [2] GENERATED DRAFT   .omc/provisioned/drafts/2026-04-20-next.js-testing.md
       Sources: 4 official docs URLs + 2 community standards
       Unvalidated: yes
       Install target: ~/.claude/skills/omc-learned/next.js-testing.md

   ### security
   [3] skills.sh   community-contributor/next-security-tips   (47 installs, updated 8mo ago)
       RED FLAGS: low install count, stale (>6mo), single-contributor
       Recommendation: REVIEW CAREFULLY or SKIP
   ```

2. For each candidate, prompt the user with actions: `[Y]es install / [N]o skip / [E]dit then install / [P]review full SKILL.md / [S]kip all for this tech`.
3. Record each decision with timestamp and reasoning (if user provided).
4. If user selects `E`dit for a generated draft: open the draft path for manual editing, then re-prompt.
5. After all candidates reviewed, present final install plan for confirmation: "Install N items, skip M, draft review-queue for Q. Proceed?" → single `[Y]/[N]`.
6. Write the decisions to `.omc/provisioned/review/YYYY-MM-DD-<slug>-decisions.md` BEFORE running any install command.

**HARD STOP:** User declines final confirmation. Write manifest with status `REJECTED` and exit cleanly. No side effects.
**HARD STOP:** Interactive approval is not available (non-interactive mode, CI, or `--dry-run`). Emit the install plan as a command-list file and exit. No installs executed.

**Why mandatory:** This is the trust boundary. Every install below this line is an execution of community-authored prompt content inside the user's Claude Code sessions. Silencing this gate turns the skill into a prompt-injection distributor.

---

## Phase 5 — Install

**Agent:** stack-provision orchestrator (single invocation)
**Input:** Review decisions file + approved candidate/draft list
**Output:** Installed skills in `~/.claude/skills/omc-learned/**` OR plugin-marketplace installs; provenance manifest at `.omc/provisioned/YYYY-MM-DD-<slug>-manifest.md`

**Protocol:**
1. Ensure `~/.claude/skills/omc-learned/` exists (create if needed).
2. For each approved candidate, execute by source type:
   - **skills.sh:** `npx skillsadd <owner/repo>` via Bash. Capture stdout/stderr.
   - **plugin-marketplace:** emit an instruction for the user to run `/plugin install <slug>@<marketplace>` in their Claude Code session (this cannot be executed by the skill itself — it is a harness primitive). Record as `pending-user-action`.
   - **whitelisted GitHub:** Download the `SKILL.md` from the repo's default branch. Write to `~/.claude/skills/omc-learned/<slug>.md`. Record the commit SHA.
   - **generated draft:** Copy from `.omc/provisioned/drafts/` to `~/.claude/skills/omc-learned/<slug>.md`. Frontmatter retains `unvalidated: true`.
3. For each install, append a record to the provenance manifest:
   ```yaml
   - slug: next.js-best-practices
     source: skills.sh
     ref: vercel-labs/nextjs-best-practices
     commit_sha: <sha-if-git>
     install_command: npx skillsadd vercel-labs/nextjs-best-practices
     installed_at: 2026-04-20T14:23:00Z
     installed_path: ~/.claude/skills/omc-learned/next.js-best-practices.md
     review_decision_id: review-7
     unvalidated: false
   ```
4. Write manifest to `.omc/provisioned/YYYY-MM-DD-<slug>-manifest.md`.

**HARD STOP:** `npx skillsadd` fails for >50% of skills.sh installs. Halt phase; write partial manifest with `status: partial_failure`; instruct user to check network / npx availability before re-running.
**HARD STOP:** Filesystem write fails (permissions) on `~/.claude/skills/omc-learned/`. Halt phase; write partial manifest.

---

## Phase 6 — Verification & Report

**Agent:** stack-provision orchestrator (single invocation)
**Input:** Provenance manifest + installed files
**Output:** `.omc/provisioned/YYYY-MM-DD-<slug>-report.md`

**Protocol:**
1. For each entry in the manifest with `installed_path` under `~/.claude/skills/omc-learned/`, verify the file exists and has valid YAML frontmatter (parsable, contains `name` and `description`).
2. Count successes, partial failures, pending user actions (plugin-marketplace), skipped items.
3. Write final report with explicit next steps:

   ```markdown
   # Stack Provision Report — <stack slug>

   **Date:** YYYY-MM-DD
   **ADR:** <path> (if applicable)
   **Stack:** <tech list>
   **Result:** SUCCESS / PARTIAL / FAILED / REJECTED

   ## Installed (N)
   [list from manifest]

   ## Pending User Action (M)
   Run these in your Claude Code session:
   - /plugin install <slug1>@<marketplace1>
   - /plugin install <slug2>@<marketplace2>

   ## Skipped (S)
   [list with reasons]

   ## Unvalidated Drafts (D)
   These are installed but flagged `unvalidated: true`. Review each before relying on it:
   [list of paths]

   ## IMPORTANT — Session Restart Required
   New skills in `~/.claude/skills/omc-learned/` are loaded at Claude Code session startup. Restart your session, then verify with `/help` that the new skills are visible.

   ## Rollback
   To remove this provision batch, delete the files listed in the `installed_path` fields of `.omc/provisioned/YYYY-MM-DD-<slug>-manifest.md` and re-run any `/plugin uninstall` commands for marketplace-sourced items.
   ```

**HARD STOP:** None. Verification is reporting-only.

</Pipeline_Phases>

<Execution_Policy>
- Every phase is sequential; Phase 4 (human gate) is non-skippable except via `--dry-run` (which exits after producing an install plan).
- Parallelism is limited to Phase 1 (per-tech discovery) and Phase 3 (per-gap generation), both via the active `/team` or CLI-first `omc team ...` runtime.
- HARD STOPs halt the pipeline with a manifest tagged `status: halted_<phase>` and a remediation path. No stage advances past a HARD STOP.
- Orchestrator NEVER writes to `~/.claude/skills/` before Phase 5. All intermediate artifacts land in `.omc/provisioned/**` and `.omc/provisioned/drafts/**`.
- Generated drafts carry `unvalidated: true` permanently; promoting them is a manual user action (edit the file, remove the flag).
- Respects `OMC_SKIP_HOOKS` only for the contract-writing phase; the human gate is NEVER bypassed by env flags.
- On cancellation (`/oh-my-claudecode:cancel` or process interrupt): any already-completed phase manifest is preserved; no partial installs in `~/.claude/skills/omc-learned/`.
</Execution_Policy>

<Input_Contract>
Exactly one positional argument is required:
- An ADR path under `.omc/decisions/` (preferred — provides full decision context).
- OR a comma-separated technology list: `"tech1, tech2, tech3"`.

Optional flags documented in Usage section.
</Input_Contract>

<Default_Config>
Baked-in defaults used when `.omc/stack-provision.config.md` is absent:

```yaml
sources_priority:
  - skills.sh
  - plugin-marketplace
  - whitelisted-github
  - generate-fallback
aspects_default:
  - best-practices
  - testing
  - security
  - performance
  - patterns
whitelisted_github_orgs:
  - anthropics
  - vercel-labs
  - supabase-community
  - microsoft
  - vercel
red_flag_thresholds:
  repo_age_days_min: 30
  stars_min: 10
  contributors_min: 2
  last_commit_max_age_days: 180
generation:
  enabled_by_default: true
  require_unvalidated_flag: true
install_targets:
  skills_sh: npx-installer
  plugin_marketplace: user-runs-slash-command
  github: direct-download-to-omc-learned
critical_techs: []
```

To override, create `.omc/stack-provision.config.md` with a YAML code block of the same shape (partial overrides merge with defaults).
</Default_Config>

<Output>
Final report at `.omc/provisioned/YYYY-MM-DD-<slug>-report.md` plus installed SKILL.md files under `~/.claude/skills/omc-learned/**`. The provenance manifest at `.omc/provisioned/YYYY-MM-DD-<slug>-manifest.md` is the authoritative record for audit and rollback.
</Output>

<Failure_Modes_To_Avoid>
- **Skipping the human gate via scripting.** Phase 4 is mandatory even if the user runs the skill 100 times. The right escape hatch for automation is `--dry-run`, which emits an install plan; it is NOT a silent bypass.
- **Writing to `~/.claude/skills/` before Phase 5.** All drafts, candidates, and contracts live under `.omc/provisioned/**`. The first filesystem write to the user's skill path happens only after explicit approval.
- **Suppressing red flags to increase install rate.** Red flags (repo age, star count, single-contributor, stale commits) are surfaced to the user in Phase 4; the skill never silently filters them out. A low install-rate is a correct outcome when the ecosystem coverage is thin.
- **Mis-classifying a plugin-marketplace install as self-executed.** Claude Code `/plugin install` is a harness slash-command; the skill cannot run it on the user's behalf. Phase 5 correctly records these as `pending-user-action`. Do not fake-record them as installed.
- **Losing provenance on generated drafts.** Every generated draft carries the full source-URL list with retrieval dates in its frontmatter. Without provenance, a generated draft is indistinguishable from a hallucinated one.
- **Promoting `unvalidated: true` drafts automatically.** The `unvalidated` flag persists until a human edits the file to remove it. The skill never promotes drafts silently.
- **Treating `--no-generate` as "safer".** `--no-generate` disables fallback coverage; if the ecosystem has no public skill for a tech × aspect, the skill user is worse off. The HUMAN GATE — not generation avoidance — is the safety mechanism.
- **Restarting from Phase 0 when re-run mid-stream.** Manifests in `.omc/provisioned/` are the resume state. If the skill is re-invoked for the same ADR, resume from the last completed phase by reading the contract and deciding which phase to enter.
- **Installing plugins from unknown marketplaces.** Plugin-marketplace candidates must reference marketplaces already known to Claude Code. Unknown marketplace slugs require a preceding `/plugin marketplace add` — the skill surfaces this as a pre-install step, never executes it silently.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- **Pipeline position:** immediately after `/ralplan` (which produces the stack ADR) and before `/product-pipeline` (which consumes stack-specific skills during Stage 5 implementation).
- **Required MCP / tools:** at least one of `WebFetch`, `WebSearch`, or `mcp__linkup__linkup-search`. For skills.sh installs: `npx` available in PATH.
- **Co-skills:** uses `external-context` internally for Phase 3 research; uses `writer` (or inline formatting) for draft SKILL.md generation; uses `document-specialist` for parallel discovery.
- **Team infrastructure:** Phases 1 and 3 run parallel workers through the current OMC team runtime (`/team` or CLI-first `omc team ...`). Avoid deprecated MCP team-runtime calls.
- **Config discovery:** `.omc/stack-provision.config.md` overrides baked-in defaults. Partial configs merge (missing keys fall back to defaults).
- **Provenance manifest format:** YAML-in-markdown at `.omc/provisioned/YYYY-MM-DD-<slug>-manifest.md`. Machine-parsable for rollback tooling.
- **Rollback:** no built-in rollback command yet — v1 emits instructions in the final report. Candidate for `stack-deprovision` follow-up skill.
- **Auditability:** the contract → candidates → coverage → drafts → review → manifest → report chain is fully persistent under `.omc/provisioned/**`, giving post-hoc traceability from "we installed this skill" back to "because this tech in this ADR, approved at this timestamp, from this source URL with this commit SHA".
- **Session restart caveat:** new skills in `~/.claude/skills/omc-learned/` are discovered at Claude Code session startup. Phase 6 explicitly instructs the user to restart the session and verify — without this prompt, users commonly assume the install failed when the skills simply aren't loaded yet.
- **Conservative invocation for CI / shared environments:** combine `--dry-run` with version-controlled `.omc/stack-provision.config.md` so the emitted install plan can be reviewed in PR before execution.
</Integration_Notes>

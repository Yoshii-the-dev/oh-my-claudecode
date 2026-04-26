---
name: stack-provision
description: Capability provisioner for backend, frontend, mobile, infra, data/AI, product UX, and visual-creative work. Use after a stack decision or when adopting technologies to derive capability packs, skill coverage, agents, creative context, review gates, quarantine installs, manifests, and rollback plans from an ADR or explicit stack list.
argument-hint: "[ADR-path | \"tech1, tech2, ...\"] [--blocks=<list>] [--surfaces=<list>] [--creative-intent=<brief>] [--aspects=<list>] [--no-generate] [--dry-run]"
level: 4
---

# Stack Provision

Turn a chosen stack into a reviewed capability system: agents, skills, context files, discovery targets, generated drafts, install decisions, manifests, and rollback records.

For day-to-day use the slash command needs **no flags, no run-ids, no manual file edits**. The orchestrator (`scripts/orchestrate.mjs`) auto-detects the latest technology ADR under `.omc/decisions/`, runs discovery + classification, and presents only the candidates that need a real decision. Everything that passes the strict gate with high trust and clean risk flags is auto-approved without prompting. Generated LLM drafts are never auto-approved; they require explicit user edit.

If the stack itself is not yet chosen, use the `technology-strategist` agent first. For a new product or major pivot, use `/product-foundation` before this skill so market, brand, competitor, technology ADR, critic verdict, and provisioning context are created in the right order. Technology Strategist owns the decision of which technologies and application blocks belong in the stack ADR; `stack-provision` consumes that ADR or its handoff command and provisions the matching skills/guidelines.

## Usage (one command)

```bash
/stack-provision
```

That is the entire user-visible interface. The orchestrator finds the latest `.omc/decisions/*technology*.md` and walks the rest of the pipeline interactively. If the user wants to override the detected ADR or pin an explicit stack list, an optional positional argument is honored:

```bash
/stack-provision .omc/decisions/2026-04-20-stack.md
/stack-provision "next.js, react, tailwind, supabase, postgres"
```

Surface, aspect, block, and creative-intent flags exist for advanced scripting and live in the **Advanced** section at the end of this file. Do not reach for them in normal usage.

## Slash skill execution (for the assistant running this skill)

When the user invokes `/stack-provision`, follow this exact flow. **Do not** invoke `init.mjs` / `provision.mjs` directly; the orchestrator owns that. Do not show run-ids or candidate ids to the user.

### Step 1 — Run plan-only

```bash
node skills/stack-provision/scripts/orchestrate.mjs --plan-only --plan-file=/tmp/stack-provision-plan.json [optional-stack-or-adr]
```

Pass the user's positional argument (ADR path or stack list) only if they typed one. Otherwise omit it — the orchestrator auto-detects the latest ADR. Read the JSON-line events on stdout; the final `event: completed status: plan-ready` confirms the plan file is ready.

### Step 2 — Read the plan and present exactly one summary line

Read `/tmp/stack-provision-plan.json`. It contains:

- `auto_approve`: candidate ids that already pass policy and will be installed silently.
- `needs_decision`: candidate ids that require a user decision.
- `rejected`: candidate ids the policy already rejected (blocked source, hard fail).
- `candidates[]`: full candidate detail keyed by `id`.

Emit **exactly one line** to the user, copied from the template below — substitute counters only, do not add prose, tables, breakdown by surface, or emoji:

> `Found N candidates. Auto-installing K. R need your decision.`

If both `needs_decision` and `rejected` are empty, the line becomes `Found N candidates. Auto-installing K. Nothing else to decide.` — then skip directly to Step 4.

### Step 3 — Decision flow for `needs_decision`

If `needs_decision.length >= policy.max_decisions_per_session` (default `5`), open with **one** batch AskUserQuestion before any per-candidate prompt:

> `K candidates need approval. Approve all that pass strict gate? (You can still skip or reject specific ones afterwards.)`
> Options: `Approve all safe`, `Decide one by one`, `Skip all`.

Per-candidate prompts are mandatory only when the user picked `Decide one by one`, or when `needs_decision.length < policy.max_decisions_per_session`.

For each per-candidate prompt, render exactly this shape — header on one line, context on one line, then options. Total prompt body must stay **≤ 200 characters** (excluding the option list):

```
<source>: <covered.surface>/<covered.technology> — <verdict.reason>
```

Optional context-line additions, in this priority order, only if non-empty and only if the total stays under 200 chars:

1. If `content_scan.severity` is `warn` or `critical`, prepend `⚠ <severity>: <first finding rule>` on its own line.
2. If `tofu_drift` exists, prepend `⚠ pinned skill changed since first install — review diff before approving.`

Options are always one of these two fixed sets — pick the second only when `draft` is non-null:

- `Approve` / `Skip` / `Reject permanently` / `Show preview`
- `Approve` / `Skip` / `Reject permanently` / `Show preview` / `Edit and approve`

When the user picks `Edit and approve`, instruct: `Open <draft.path>, edit, remove the line containing 'review-required: remove this line after editing', save, then continue.`

**Forbidden in this step**: A/B/C/D-style enumerated menus, trust-signal numeric breakdowns inside the header, multi-row markdown tables, AI emoji decoration. Trust scores, risk flags, freshness — they belong in `Show preview`, not the headline.

Append each decision as one JSON line to `/tmp/stack-provision-decisions.jsonl`:

```jsonl
{"type":"decision","candidate_id":"...","action":"approve"}
{"type":"decision","candidate_id":"...","action":"skip"}
{"type":"batch_resolve","remaining":"approve_safe"}
```

Valid `action` values: `approve | skip | reject | edit`.

### Step 4 — Apply the plan

```bash
node skills/stack-provision/scripts/orchestrate.mjs --apply --plan-file=/tmp/stack-provision-plan.json --decisions-file=/tmp/stack-provision-decisions.jsonl
```

Read the JSON-line events. Use this **exact lookup table** — copy the message verbatim, substitute `<…>` placeholders, do not paraphrase or add prose around it. Events not listed here are silent (machine-only).

| Event | User-facing message |
| --- | --- |
| `completed status: success` | `Done. K skills installed. Manifest at <manifest_path>.` (substitute K = `installed.length`) |
| `completed status: partial` | `Skills installed, but verification reported a problem. Review <run_dir>/state.json.` |
| `completed status: rolled-back` | `Critical hash drift — auto-rolled back. Inspect <run_dir>/state.json before retrying.` |
| `completed status: paused-for-edits` | `These drafts still need editing: <edit_paths>. Edit them, then run /stack-provision again.` |
| `completed status: cancelled` | `Cancelled — no skills were installed.` |
| `revalidation` (only when `local_drift > 0` or `upstream_drift > 0`) | `Revalidation found N drifted skills. Run /stack-provision to refresh.` |
| `cleanup_proposal` | `These N skills have not been used in over 60 days: <slugs>. Review and remove or run /stack-provision defer-cleanup to silence for now.` |
| `rollback status: failed` | `Automatic rollback failed; run is in partial state — recover manually from <run_dir>.` |
| `error` | Surface `error.message` verbatim and exit. |

**Silent (do not surface)**: `phase`, `detect`, `review_summary`, `request_decision`, `install_plan`, `post_install_verify`, `rollback status: completed`, `cve_scan`, `telemetry_recorded`, `tofu_check`, `tofu_pinned`, `sandbox_dryrun`. Critical findings from these feeds are already attached as `risk_flags` on candidates and will surface in Step 3 prompts automatically — do not echo them again here.

## Network discipline

External discovery — `skills-sh`, `agentskill-sh`, `github`, and any custom registry from `discovery_policy.skill_source_registry` — runs through a single rate-limited HTTP client (`scripts/network-client.mjs`). The client owns rate-limiting, retries, concurrency caps, in-flight dedup, disk caching, and API-key injection so individual discovery adapters cannot accidentally hammer a registry the way they did before.

**Per-host budget** (token bucket, refilled continuously):

| Host | Default RPM | Concurrency | API-key env |
| --- | --- | --- | --- |
| `skills.sh` | 25 | 2 | `SKILLS_SH_API_KEY` |
| `agentskill.sh` | 30 | 2 | `AGENTSKILL_SH_API_KEY` |
| `api.github.com` / `github.com` / `raw.githubusercontent.com` | 60 | 4 | `GITHUB_TOKEN` (or `gh auth token` fallback) |
| Other registered marketplaces | 30 | 2 | configured per registry |
| Unconfigured hosts | 30 | 4 | none |

skills.sh advertises 30 rpm without a key; we default to 25 to leave headroom for a parallel run from a teammate. Set `SKILLS_SH_API_KEY` in the environment to lift the limit per the official API docs.

**Retry behaviour.** A `429` triggers up to 3 retries with the `Retry-After` header honored verbatim (cap 60s). Transient `5xx` use exponential backoff (500ms → 1s → 2s, with jitter, cap 60s). After three failures the run records a discovery warning and continues with whatever was already fetched — provisioning never silently swallows the gap.

**Concurrent dedup.** Identical concurrent fetches share one in-flight Promise so duplicate `discoveryQueries` (e.g. `react`, `react`, `react native`) do not multiply the bucket consumption.

**Disk cache.** Successful responses land in `.omc/stack-provision/discovery-cache.json` keyed by URL with default TTL `21600` seconds (6h). On the next `/stack-provision` invocation, cached payloads short-circuit the network entirely. Override the TTL via `discovery_policy.cache_ttl_seconds` in the project config, the CLI flag `--cache-ttl=<seconds>`, or disable the cache with `--no-cache` (e.g. when intentionally probing live registries during a release).

**API-key injection.** Each registry can declare `api_key_env` plus an optional `auth_header_template` (default `Bearer {token}`). The client reads the env var at request time, never persists it, and never logs it. No secrets live in the repo or in `.omc/`. To use a non-`Bearer` header, point `auth_header_template` at the explicit form, e.g. `"X-API-Key: {token}"`.

**Custom registries.** Any project-level config supplied via `--config=<path>` may extend or override `discovery_policy.skill_source_registry[]` with the same fields:

```json
{
  "id": "internal-skills",
  "type": "marketplace",
  "search_url_template": "https://skills.acme.internal/api/search?q={query}",
  "domains": ["skills.acme.internal"],
  "rate_limit_rpm": 120,
  "concurrency": 4,
  "api_key_env": "ACME_SKILLS_TOKEN",
  "auth_header_template": "X-API-Key: {token}",
  "cache_ttl_seconds": 1800,
  "install_policy": "explicit-review"
}
```

Configuration validation lives in `schemas/config.schema.json`; unknown fields are still allowed (`additionalProperties: true`) so operators can attach metadata for their own tooling.

## Output discipline

The slash-skill must follow these three rules to keep the chat compact and predictable:

1. **One line per phase update.** Step 2 is a single line; Step 4 is one line per non-silent event. Never produce a multi-paragraph status update or a recap of phase completion. Phase tables, surface breakdowns, and candidate matrices belong in `<run_dir>/review.md` on disk, not in the chat.
2. **Forbidden patterns.** A/B/C/D enumerated menus, "Your decision: A/B/C/D" prompts, decorative emoji, multi-row markdown tables, restating the plan after the user has approved it. The only legal multi-option prompt is the per-candidate or batch AskUserQuestion shape from Step 3, with options drawn from the fixed sets there.
3. **Silence is fine.** If no `needs_decision` and no surfaced event triggers, the only chat output the user sees for the entire run is the Step 2 line plus `Done. K skills installed. Manifest at <manifest_path>.` That is the autonomous-default target shape — anything more must be justified by an explicit event or a real user decision.

### Step 5 — Cleanup

Delete `/tmp/stack-provision-plan.json` and `/tmp/stack-provision-decisions.jsonl` after a successful or cancelled run.

## Flags

- `--surfaces=<list>`: Explicit capability surfaces. Known values: `backend`, `frontend-engineering`, `frontend-product`, `visual-creative`, `mobile`, `infra-devops`, `data-ai`, `auth-identity`, `product-analytics`, `finance-transactions`.
- `--blocks=<list>`: Explicit application capability blocks. Known values include `auth`, `product-analytics`, and `finance-transactions`; aliases like `authentication`, `analytics`, and `payments` map to the canonical blocks.
- `--surfaces-only`: Use only the explicit `--surfaces` list instead of unioning it with inferred surfaces.
- `--creative-intent=<brief>`: Adds the `visual-creative` surface and preserves its full creative aspect set.
- `--aspects=<list>`: Narrow aspects for non-creative surfaces. With `--creative-intent`, visual aspects still include art direction, generated imagery, typography, illustration, motion, brand assets, and visual QA.
- `--no-generate`: Discovery and review only. Do not generate draft skills for gaps.
- `--dry-run`: Build the run contract and review plan without writing files or installing anything.
- `--json`: Emit machine-readable output from the helper.
- `--config=<path>`: Override `config/default-capability-packs.json`.
- `--out=<path>`: Override `.omc/provisioned/runs`.
- `--run-id=<id>`: Deterministic run id for tests or repeatable scripts.

## Run Contract

Phase 0 must produce these artifacts:

```text
.omc/provisioned/
  current.json
  runs/<run-id>/
    contract.json
    capability-matrix.json
    state.json
    review.md
```

Use:

```bash
node skills/stack-provision/scripts/init.mjs "<ADR path or stack list>" [flags] --json
```

Translate the user's command into one stack/ADR argument plus explicit helper flags. Do not pass the whole slash-command text as a single quoted argument if it includes flags.

If the user provided an ADR path, the helper extracts stack entries from `## Decision`, `## Chosen Stack`, `## Technology Stack`, or `## Stack`. Otherwise it treats the first positional argument as a comma-separated technology list.

The generated contract is the source of truth for all later phases. Do not invent extra surfaces, aspects, or install targets outside the contract unless you write an updated contract first.

## Capability Surfaces

- `backend`: APIs, data stores, auth, security, reliability, observability, testing, performance.
- `frontend-engineering`: Components, state, routing, forms, accessibility, performance, frontend tests, visual regression.
- `frontend-product`: Flows, onboarding, empty/error states, copy, analytics, experiments, feedback loops.
- `visual-creative`: Art direction, visual language, inspiration synthesis, generated bitmap assets, iconography, typography, illustration, motion, brand assets, visual QA.
- `mobile`: App architecture, navigation, native/platform APIs, offline data, accessibility, release readiness.
- `infra-devops`: CI/CD, containers, cloud infra, secrets, monitoring, rollback, cost.
- `data-ai`: Data pipelines, data quality, model APIs, evals, vector search, AI observability, cost.
- `auth-identity`: Authentication, sessions, OAuth/OIDC, authorization, privacy, abuse/security, and account recovery.
- `product-analytics`: Event taxonomy, instrumentation, funnels, experiments, privacy-safe tracking, and metric governance.
- `finance-transactions`: Payments, billing, subscriptions, ledgers, idempotency, reconciliation, refunds, compliance, and audit trails.

## Technology Decision Contract

Use `product-foundation` for new-product foundation work and `technology-strategist` directly for focused feature preflight when the user has product intent but the stack is incomplete or undecided. Technology Strategist should produce `.omc/decisions/YYYY-MM-DD-technology-<slug>.md` with:

- `stack`: concrete technologies already chosen or proposed.
- `application_blocks`: product capability blocks such as `auth`, `product-analytics`, `finance-transactions`.
- decision drivers and alternatives considered.
- skill/guideline targets for each block.
- a concrete `stack-provision` handoff command.
- a critic verdict path or explicit critic verdict field; promotion is blocked unless critic verdict is `approve`.

Stack technologies are not a fixed enum. Additions are expected. Prefer adding them through `technology-strategist` ADRs and, when needed, a project override config passed with `--config=<path>` that extends `tech_match`, `application_blocks`, `aspect_aliases`, and `query_expansions`.

## Visual-Creative Contract

When `visual-creative` is present, treat it as a first-class capability surface. It must not be reduced to CSS styling or frontend implementation.

Use available project context selectively:

- `.omc/constitution.md`
- `.omc/brand/index.md`
- `.omc/brand/core.md`
- `.omc/brand/grammar.md`
- `.omc/brand/inspiration.md`
- `.omc/brand/expressions/current.md`
- `.omc/digests/competitors-landscape.md`
- `.omc/ideas/current.md`

Expected outputs for this surface can include:

- Direction boards and inspiration ledgers.
- Generated image prompts and bitmap assets.
- Icon, illustration, shape, texture, and motion language.
- Typography exploration and font selection criteria.
- Visual QA criteria and screenshot verdict loops.

Prefer existing local skills when available: `imagegen`, `meaning-driven-ui-builder`, `visual-verdict`, `brand-architect`, `brand-steward`, `brand-variations-generate`, `inspiration-fetch`, and `competitor-scout`.

## Architecture

The provisioner has six bounded phases.

1. `contract`: Deterministically parse the stack and write `contract.json`, `capability-matrix.json`, `state.json`, and `review.md`.
2. `discovery`: Search installed skills, bundled OMC skills, configured marketplace registries, skills.sh, plugin marketplaces, and whitelisted repositories for each matrix cell. Local plugin skill caches are intentionally skipped.
3. `gap-draft`: If generation is allowed, create draft skills only inside the run quarantine directory. Drafts are never auto-promoted.
4. `review`: Present one install plan with candidate previews, provenance, risk flags, file targets, and hashes. Require explicit human approval.
5. `promote`: Install only approved items, write `manifest.json`, and keep backups for overwritten files.
6. `verify-or-rollback`: Verify installed skills/plugins load. Roll back failed or rejected installs from the manifest.

State transitions must be recorded in `state.json`. Terminal statuses are `success`, `partial`, `failed`, `rejected`, and `dry_run`.

## Advanced — Executable Commands (scripting / debugging only)

> **Default users do not need this section.** The slash skill flow above (orchestrator + plan/apply) is the supported path. Reach for raw scripts only when scripting CI, debugging a failed run, or extending the toolchain.

Use `scripts/init.mjs` for Phase 0 and `scripts/provision.mjs` for the remaining executable phases.

```bash
# Phase 0: contract + matrix
node skills/stack-provision/scripts/init.mjs "<ADR path or stack list>" [flags] --json

# Phase 1: discovery adapters
node skills/stack-provision/scripts/provision.mjs discover .omc/provisioned/runs/<run-id> \
  --sources=installed,bundled,skills-sh,plugin-marketplace,github,agentskill-sh \
  --source-index=agentskill-sh=<json-path-or-url> \
  --json

# Phase 4: review decision and install-plan hash
node skills/stack-provision/scripts/provision.mjs review .omc/provisioned/runs/<run-id> \
  --approve=<candidate-id,candidate-id> --approved-by=<name> --critic-verdict=approve --json

# Phase 5: promote approved candidates only
node skills/stack-provision/scripts/provision.mjs promote .omc/provisioned/runs/<run-id> \
  --skill-root .claude/skills/omc-provisioned --json

# Phase 6: verify or rollback
node skills/stack-provision/scripts/provision.mjs verify .omc/provisioned/runs/<run-id> --json
node skills/stack-provision/scripts/provision.mjs rollback .omc/provisioned/runs/<run-id> --json
```

Discovery sources:

- Default discovery is research-first: `skills-sh`, `plugin-marketplace`, and `github` are searched before installed/bundled skills. It does not crawl every registered marketplace by default.
- Indexed marketplaces are opt-in but ergonomic: any registered source passed as `--source-index=<registry-id>=<json path or url>` is added to the selected source list automatically, even when `--sources` does not mention it.
- `installed`: scans installed skill roots. Override with repeated `--installed-root=<path>`.
- `bundled`: scans project bundled skills. Override with repeated `--bundled-root=<path>`.
- Local discovery defaults are project-scoped only: `.claude/skills`, `.agents/skills`, and `skills` under `--project-root`/the current working directory. User-level home skill roots are not scanned unless explicitly passed with `--installed-root`.
- `plugin`: disabled. Local plugin skill caches are not parsed because they duplicate installed/bundled skills and can include stale marketplace snapshots.
- `skills-sh`: reads `--skills-sh-index=<json path or url>`, or best-effort network search with `--network`.
- `plugin-marketplace`: reads `--plugin-marketplace-index=<json path or url>`.
- `github`: reads `--github-index=<json path or url>`, or best-effort GitHub repository search with `--network --github-org=<org>`.
- Registry sources from `discovery_policy.skill_source_registry` can be selected by id, for example `agentskill-sh`, `agent-skills-cc`, `findskills`, `llmskills`, `aiagentbase`, `skillsmd`, `skillhq`, `cskills-sh`, or `github-skill-collections`. Provide `--source-index=<registry-id>=<json path or url>` for deterministic parsing, or use `--network` when that registry has a configured `search_url_template` or `index_url`.

Primary marketplace handling:

| Source | Search | Install/download handling |
| --- | --- | --- |
| `skills-sh` | Prefer `--skills-sh-index=<json path or url>` or `--source-index=skills-sh=<json path or url>`. With `--network`, query the configured search endpoint. | If the candidate includes `skill_md_url` and `sha256`/`content_sha256`, `promote` downloads and verifies the content hash. Otherwise discovery extracts `<org>/<repo>` from the entry's `html_url` (or from any pre-shaped `repo_path`/`repository`/`repo`/`ref` field) and emits a pending `npx skills add <org>/<repo> -p -y`. Slug-only entries with no resolvable repo path fall through to `external-command-unresolved` with the `unresolvable-install-target` risk flag — the orchestrator never issues a known-broken `npx skills add <slug>`. |
| `agentskill-sh` | Prefer `--source-index=agentskill-sh=<json path or url>` for deterministic discovery. With `--network`, query the configured search endpoint; outside stack-provision, agentskill.sh also supports `/learn <query>` search after installing its learn plugin. | If the candidate includes `skill_md_url` and expected checksum, treat it as a verified download. Otherwise emit a pending `/learn {ref}` action; `/learn` performs the interactive install and security preview. |
| `plugin-marketplace` | Read `--plugin-marketplace-index=<json path or url>` or `--source-index=plugin-marketplace=<json path or url>`. | Emit a pending `/plugin install ...` action. Local plugin caches are still skipped. |
| `github` | Read `--github-index=<json path or url>` or `--source-index=github=<json path or url>`. With `--network`, use GitHub repository search and optional `--github-org=<org>`. | Prefer entries with previewable `content_path` or `skill_md_url` plus checksum. Repository-only matches stay as manual review actions. |

Promotion defaults to the current project: without `--skill-root`, approved skills are installed into `.claude/skills/omc-provisioned` under `--project-root`/the current working directory.

Frontend/UI discovery uses broader query hints, but it still provisions skills, not UI code directly. For frontend and visual surfaces, discovery expands toward shadcn registries, Radix primitives, Storybook, Tailwind design systems, Figma/community UI kits, Magic UI, 21st.dev-style registries, Aceternity/React Bits-style motion components, and visual QA. Component installs from those services should remain pending manual actions unless a reviewed skill packages a deterministic, checksum-verifiable workflow.

Review is non-optional. `promote` refuses to run unless `review-decision.json` confirms approval and its `install_plan_hash` still matches `install-plan.json`.

Strict gate is mandatory before install: `source_trust >= 0.85`, `freshness <= 180 days`, valid checksum, and no license conflict. Network `download-skill` candidates must carry an expected `sha256`/`checksum_sha256`/`content_sha256`; the downloaded `SKILL.md` is hashed again before copy.

Checksum-missing candidates from high-trust registries pass the gate under TOFU (trust-on-first-use): when `policy.strict_gate.checksum_tofu_allowed` is `true` (default) and the candidate's `source_trust` is at least `policy.strict_gate.checksum_tofu_min_trust` (default `0.9`), the gate sets `tofu_pending: true` instead of recording `checksum_invalid`. The first install captures the SKILL.md hash to `.omc/stack-provision/pins/<slug>.snapshot.md` and subsequent runs detect drift via the `tofu_check` event. Set `checksum_tofu_allowed: false` in the project policy file to fall back to the strict pre-TOFU behaviour. Candidates that still fail the gate stay in quarantine and require manual follow-up.

Source-level approval is intentionally narrow. `--approve-source` and `--approve-local` may batch-approve only low-risk installed or bundled skill candidates. External, generated, network-download, command-based, or warning/critical risk candidates require explicit `--approve=<candidate-id>` after reading the review bundle.

## Discovery Rules

Read `capability-matrix.json` first. Each cell is one coverage need:

```json
{
  "surface": "visual-creative",
  "technology": "framer-motion",
  "aspect": "motion",
  "capability_packs": ["motion-system"]
}
```

Matrix generation is intentionally conservative:

- A surface only uses technologies that match that surface's `tech_match` list. Explicit surfaces with no matching stack technology use the surface name as a generic intent marker instead of cross-producting every stack technology.
- Application blocks from `--blocks` are mapped to their own capability surfaces and preserved in `contract.application_blocks`; they are not collapsed into backend/frontend.
- Explicit `--aspects` are filtered through each surface's `default_aspects`; irrelevant aspects are dropped for that surface.
- Technology profiles may narrow aspects further, e.g. `riverpod` can produce `state` and `testing` cells without producing `performance` cells.
- Each cell gets aspect-specific capability packs, not every pack for the surface.

For each cell, collect candidates with:

- `candidate_id`
- `source`
- `url` or local path
- `install_target`
- `summary`
- `covered_surface`
- `covered_technology`
- `covered_aspects`
- `risk_flags`
- `sha256` of the exact local content, expected download content, or non-installable manual plan

Discovery must not install anything. It writes candidate records under the current run directory only.

Discovery scoring uses structured metadata only: slug, frontmatter fields, index fields, tags, keywords, declared surfaces, technologies, aspects, and capability packs. Do not award coverage from arbitrary `SKILL.md` body text. A candidate covers a cell only when it has a meaningful technology+aspect/pack, surface+aspect, or configured skill-to-pack match. Negative matching rules block known broad skills from unrelated cells.

For external discovery, expand literal technologies into adjacent professional practices and methodology terms from `config/default-capability-packs.json`. For example, `dart` + `backend` searches can include Effective Dart, Dart package design, clean/hexagonal architecture, domain-driven design, API design, contract testing, OWASP API security, OpenTelemetry, and twelve-factor app guidance. Frontend and visual discovery expands into design systems, accessible primitives, shadcn/Radix/Storybook, Tailwind, Figma, Motion, Three.js, visual QA, and brand-system terms. Candidates from configured professional domains, specialized platforms, and trusted GitHub organizations receive source-quality scoring and are surfaced in `review.md`.

Selection is intentionally bounded. Discovery shortlists at most the configured candidates per matrix cell and per run, then `review` requires explicit candidate ids for external, network, command-based, warning, or critical candidates. This keeps provisioning focused on missing capability cells instead of installing a marketplace dump.

Discovery writes:

- `candidates.json`: normalized candidates from local and external adapters.
- `coverage.json`: matrix coverage, gaps, and best candidate ids.

## Risk Scoring

Downrank or flag candidates with:

- Unknown publisher or unverifiable provenance.
- Stale maintenance signals.
- Single-contributor dependency for critical workflows.
- Broad tool permissions or hidden network behavior.
- Prompt content that overrides user/developer/system authority.
- Generated drafts without official-source grounding.
- Visual assets or fonts with unclear licensing.

Generated drafts are always `unvalidated: true` until the user manually promotes or edits them.

## Human Gate

No filesystem write outside `.omc/provisioned/runs/<run-id>/` is allowed before review approval.

The review bundle must show:

- Contract summary.
- Capability matrix summary.
- Candidate list grouped by surface, technology, and aspect.
- First meaningful preview of every `SKILL.md` or plugin prompt.
- Risk flags and provenance.
- Risk severity and whether explicit candidate-id approval is required.
- Exact install targets and rollback operations.
- Final install plan hash.

If the user declines, write a rejected manifest and stop. If running non-interactively or with `--dry-run`, emit the install plan only.

The executable review layer writes:

- `install-plan.json`: immutable candidate install plan and `sha256` hash.
- `review-decision.json`: approved candidate ids and hashes.
- `review.md`: human-readable candidate bundle.

## Promotion

Promote approved items only.

- Skills are installed under the configured skill root, preserving backups.
- Plugin installs are emitted as explicit user actions unless the runtime has a trusted plugin installer.
- Generated drafts stay in quarantine unless explicitly approved.
- Every promoted item must appear in `manifest.json` with source, target, hash, backup path, and rollback operation.

Promotion supports local `copy-skill` candidates directly. Network downloads, plugin marketplace installs, skills.sh commands, and unsupported external commands are written to `pending_user_actions` unless the runtime explicitly enables trusted execution.

## Verification

After promotion:

1. Confirm installed files exist and hashes match the manifest.
2. Confirm built-in skill loading still works when relevant.
3. Run the narrowest available test or loader check for changed provisioner files.
4. If verification fails, use manifest rollback records before reporting completion.

## Skill Resources

- `scripts/init.mjs`: deterministic run initializer.
- `scripts/provision.mjs`: discovery/review/promote/verify/rollback executor.
- `config/default-capability-packs.json`: default surfaces, technology matchers, capability packs, agent mappings, and related skills.
- `schemas/contract.schema.json`: run contract schema.
- `schemas/capability-matrix.schema.json`: capability matrix schema.
- `schemas/candidates.schema.json`: normalized discovery candidate schema.
- `schemas/coverage.schema.json`: coverage matrix schema.
- `schemas/install-plan.schema.json`: install plan schema.
- `schemas/review.schema.json`: approval decision schema.
- `schemas/manifest.schema.json`: install/rollback manifest schema.
- `schemas/config.schema.json`: capability pack config schema.

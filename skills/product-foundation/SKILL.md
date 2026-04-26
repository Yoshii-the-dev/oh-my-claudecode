---
name: product-foundation
description: Product foundation workflow for a new product or major pivot. Defaults to foundation-lite for pre-MVP work: vision, competitors, meaning hypothesis, ecosystem map, opportunity map, and first usable loop before any technology ADR/provisioning. Use foundation-full only when stack strategy is explicitly needed.
argument-hint: "\"<product idea or market/problem>\" [--pre-mvp] [--foundation-lite|--foundation-full] [--deep-brand] [--fresh-start] [--skip-provision] [--backend-first|--product-first]"
level: 4
---

# Product Foundation

Build the product foundation before feature execution: articulate the product, scout the market, synthesize brand/constitution and meaning, map the product capability/ecosystem, rank the opportunity portfolio, then hand off the first usable loop to `backend-pipeline` and/or `product-pipeline`.

This skill is the top-level route for starting a new product or major pivot. It is intentionally not an implementation pipeline. For pre-MVP products, the default is `foundation-lite`: get to a usable product loop before deep infrastructure. `foundation-full` adds technology strategy, critic gate, and stack provisioning only when the user explicitly requests it, the project already has traction, or the first usable loop genuinely requires a stack decision.

## Usage

```bash
/oh-my-claudecode:product-foundation "<product idea or market/problem>"
/product-foundation "<product idea>" --pre-mvp --foundation-lite --deep-brand
/product-foundation "<product idea>" --foundation-full --skip-provision
/product-foundation "<major pivot>" --fresh-start --pre-mvp --deep-brand
/product-foundation "<clear product concept>" --skip-provision
/product-foundation "<backend-heavy product>" --backend-first
```

## When To Use

- Starting a new product from an idea, market, or vague problem.
- Repositioning after a competitor, market, or brand shift.
- Preparing a new product ecosystem before calling `backend-pipeline` or `product-pipeline`.
- You need opportunity ranking and first usable loop selection before execution.
- You need technology strategy and skill provisioning to reflect product blocks such as auth, analytics, telemetry, billing, retention, content, moderation, or domain-specific systems. Use `--foundation-full` for this unless a current loop-blocking ADR is explicitly needed.

Do not use this for a single already-approved feature. Use `backend-pipeline` or `product-pipeline` directly, which will run their own conditional technology preflight when needed.

## Architecture

The foundation route is evidence-first and resumable through `.omc/**` artifacts:

```text
deep-interview OR ideate
  -> competitor-scout
  -> brand-steward
  -> brand-architect / meaning synthesis
  -> product-strategist --capability-map
  -> product-ecosystem-architect
  -> priority-engine
  -> experience gate
  -> first usable loop handoff

foundation-full only:
  -> technology-strategist
  -> researcher if needed
  -> critic
  -> stack-provision
  -> backend-pipeline / product-pipeline handoff
```

The orchestrator owns state transitions. Agents own their artifacts. `stack-provision` is the only lane that may write installed skills, and only after critic approval and Strict Gate review.

## Modes

### foundation-lite (default for pre-MVP and empty apps)

Use when the app has no usable loop, no traction, or the invocation includes `--pre-mvp`, `--fresh-start`, or `--foundation-lite`.

Route: vision -> competitors digest -> constitution/meaning hypothesis -> compact capability map -> ecosystem map -> portfolio ledger -> opportunity map -> first vertical slice.

Hard rule: produce `.omc/portfolio/current.json`, `.omc/opportunities/current.md`, and `.omc/roadmap/current.md` before any technology ADR. In lite mode, stop after recommending the first usable loop unless a single enabling ADR is explicitly required to build that loop. Pre-MVP foundation may create at most 1-2 ADRs before the first vertical slice, and only with a written reason tied to the selected core slice.

### foundation-full

Use only when `--foundation-full` is explicit, the product already has traction, the user asks for stack/provisioning, or the selected first loop cannot proceed without a stack decision. Full mode runs technology-strategist, critic, and stack-provision after priority-engine.

## Pipeline

### Phase 0 - Intake Classification

Read the invocation, existing `.omc/constitution.md`, `.omc/ideas/current.md`, `.omc/specs/current.md`, `.omc/competitors/index.md`, `.omc/competitors/landscape/current.md`, `.omc/research/current.md`, `.omc/brand/index.md`, and `.omc/provisioned/current.json` when present.

First calibrate current-state truth from the filesystem:

- Check whether a usable app shell/source project exists (`package.json`, `pubspec.yaml`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `src/`, `app/`, `lib/`, or equivalent).
- If no usable source/app shell exists, declare implementation state as `greenfield: nothing implemented` regardless of old `.omc/**` artifacts, memories, or scouting contracts.
- Treat existing `.omc/**` artifacts as intent/research/reference until they are explicitly accepted for this run. Do not infer implemented features, current phase, selected stack, or roadmap status from old artifacts without matching current filesystem evidence.
- If an artifact cites old project memory, but `.omc/project-memory.json` is absent, regenerated, or has a different project fingerprint, mark that citation stale and do not use it as baseline truth.

If `--fresh-start` is present, create a reset/context-boundary note before reading legacy project details:

- Write `.omc/reset/YYYY-MM-DD-<slug>.md` with the reason for the reset, allowed carry-over artifacts, and explicitly ignored legacy areas.
- Treat existing source code and old `.omc/**` artifacts as legacy reference only unless the user explicitly whitelists them.
- Keep `.git/`, framework files, reusable prompts/skills, and OMC infrastructure in scope; ignore stale product implementation decisions by default.

Classify the input:

| Condition | Next step |
|---|---|
| Problem/product is vague, missing target user, missing job, or founder says not to assume | `/deep-interview "<input>"` |
| Problem is clear but solution space is open | `/ideate "<input>"` |
| Product concept and first feature are clear | continue to competitor scout |
| Existing foundation artifacts are fresh and accepted | skip to Phase 4.5 priority portfolio unless `--foundation-full` is explicit |

Default mode selection:
- `foundation-lite` when `--pre-mvp`, `--fresh-start`, no usable app shell exists, no source app exists, or the user asks for a new product from scratch.
- `foundation-full` only when explicitly requested or when the selected first loop needs technology ADR/provisioning.

Freshness defaults:
- Competitor landscape: fresh for 30 days; use `competitor-scout --refresh` when stale.
- Constitution: valid until a major pivot, new target segment, or material market shift.
- Technology ADR/provisioning manifest: valid only for capability blocks explicitly covered by the current feature/product block.

### Phase 1 - Product Articulation

Produce at least one vision source:

- `/deep-interview "<vague idea>"` writes `.omc/specs/**` when the problem is ambiguous.
- `/ideate "<problem statement>"` writes `.omc/ideas/**` when divergent hypotheses are needed.

Hard stop: do not run brand or stack strategy without at least one current vision source.

### Phase 2 - Competitive Landscape

Run:

```bash
/competitor-scout "<niche or product category>"
```

Use `--refresh` if a watchlist already exists. The output must include `.omc/competitors/index.md` and `.omc/competitors/landscape/current.md`, or a halted artifact explaining why scouting could not complete.

Hard stop in post-MVP mode: fewer than three credible competitor dossiers. In pre-MVP mode, continue but mark brand and technology whitespace assumptions LOW confidence.

### Phase 3 - Brand Constitution And Meaning

Run:

```bash
/brand-steward --pre-mvp --deep
```

when the product is pre-MVP and needs a hypothesis-grade constitution, or:

```bash
/brand-steward --deep
```

when post-MVP or sufficient research/competitor inputs exist. Omit `--deep` only when the user explicitly wants a shallow brand layer.

Output: `.omc/constitution.md`.

Hard stop: if brand-steward refuses due to missing research/vision inputs, do not route to implementation. Remediate the missing input first.

Meaning system requirement:

- If `.omc/meaning/current.md` is absent or stale, run brand-architect or a semantic synthesis pass to produce it.
- The meaning artifact must be compact: user meanings, category codes, enemy moves, symbolic assets, content angles, and marketing hooks.
- Use laddering / means-end chains, semiotic residual-dominant-emergent codes, repertory-grid axes, JTBD/ODI, Kano, Self-Determination Theory, and COM-B/Fogg as decision tools, not as long essays.
- Missing meaning context lowers confidence but does not block foundation-lite.

### Phase 4 - Product Capability & Launch Map

Invoke `product-strategist` after brand and market context exist:

```bash
/product-strategist --capability-map "<product scope + competitor/brand context>"
```

Product Strategist must produce `.omc/product/capability-map/YYYY-MM-DD-<slug>.md` and refresh `.omc/product/capability-map/current.md`.

The capability map must separate:

- MVP feature set.
- first usable loop candidate.
- market-winning differentiators.
- required product systems such as auth, onboarding, analytics, telemetry, admin, support, billing, content, moderation, and domain-specific systems.
- retention/growth systems.
- launch readiness gates.
- backend/product pipeline split.
- capability blocks for `technology-strategist` when foundation-full is needed.
- compact roadmap signals for priority-engine.
- deferred systems with revisit triggers.

Hard stop: do not route to priority-engine without a current capability map unless product-strategist explicitly reports that source context is too thin and emits a blocked/needs-research map.

### Phase 4.5 - Ecosystem And Priority Portfolio

Run product-ecosystem-architect when `.omc/ecosystem/current.md` is absent/stale or core features lack depth paths:

```bash
/prompts:product-ecosystem-architect "<product scope + capability map + meaning context>"
```

Output: `.omc/ecosystem/current.md`.

Then run:

```bash
/priority-engine "<cycle goal or first foundation cycle>"
```

Priority Engine must write:

- `.omc/portfolio/current.json` — machine-readable work-item ledger with stable ids, lane, status, confidence, dependencies, selected_cycle, and evidence.
- `.omc/portfolio/current.md` — human-readable projection when tooling is available.
- `.omc/opportunities/current.md` — 20-40 ranked candidate moves with evidence, confidence, expected learning, and dependency unlock.
- `.omc/roadmap/current.md` — rolling 2/6/12-week roadmap.

Cycle selection must include:

- 1 core product slice.
- 1 enabling task.
- 1 learning/research task.

Hard stop: do not run technology strategy, critic, or provisioning before `.omc/portfolio/current.json`, `.omc/opportunities/current.md`, and `.omc/roadmap/current.md` exist, unless the user explicitly asks for a stack-only audit instead of product foundation.

For empty/pre-MVP apps, the selected core product slice must be a first usable loop. For knitting-like products, prefer `import/open sample pattern -> row track -> persist progress -> return next session` over backend-only schema/package work.

Run the foundation contract gate before any execution or technology handoff:

```bash
omc portfolio validate
omc portfolio project --write
omc doctor product-contracts --stage foundation-lite
```

Errors are blocking. Warnings, including a missing meaning graph in lite mode, must be reflected in confidence and the next learning task.

### Phase 5 - Capability Stack Strategy (foundation-full only)

Skip this phase in foundation-lite unless priority-engine marks the selected cycle as blocked by a concrete ADR/provisioning decision.

Before entering this phase, run:

```bash
omc doctor product-contracts --stage technology-handoff
```

Do not continue if the report shows direct technology routing without priority-engine output.

Invoke `technology-strategist` after brand and market context exist:

```bash
/prompts:technology-strategist "<product scope + first 3 feature directions + known stack>"
```

Technology Strategist must:

- classify domain and monetization/engagement model.
- consume `.omc/product/capability-map/current.md` when present.
- consume `.omc/opportunities/current.md` and `.omc/roadmap/current.md` before proposing any ADR.
- convert product capability blocks into technology options, scorecards, compatibility reports, and skill targets.
- evaluate retention/growth blocks, not only engineering blocks.
- produce weighted scorecards and pairwise compatibility report.
- request `deep-interview` if `requirements_completeness < 0.75` or `unknown_critical_inputs >= 2`.
- request researcher (`document-specialist`) if `top2_score_gap < 8`, critical compatibility is unknown, or fresh external evidence is missing.
  *(If requested, orchestrator must run `/document-specialist` to produce `.omc/audits/tech-research.md`, then hard-loop back to `technology-strategist` to finalize the ADR).*
- emit handoff-envelope v2 and a concrete `stack-provision` command.

Hard stop: any `blocked` compatibility pair. The strategist must revise or route to critic; provisioning is forbidden.

### Phase 6 - Critic Gate

Run critic on the technology ADR against the capability map benchmark:

```bash
/prompts:critic ".omc/decisions/YYYY-MM-DD-technology-<slug>.md" --against=".omc/product/capability-map/current.md"
```

Verdicts:

| Verdict | Route |
|---|---|
| `APPROVE` | continue to stack-provision |
| `REVISE` | return to technology-strategist with exact findings |
| `REWIND` | hard rewind to `product-strategist --capability-map`, invalidate downstream scorecard/compatibility/provision artifacts |

Hard rewind limit is two. After two rewinds, run `/deep-interview` and require human decision before further stack changes.

### Phase 7 - Strict Stack Provisioning

Skip in foundation-lite. In foundation-full, skip only when `--skip-provision` is explicit. Otherwise run the command emitted by the ADR, then:

```bash
node skills/stack-provision/scripts/init.mjs "<ADR path>" --json
node skills/stack-provision/scripts/provision.mjs discover .omc/provisioned/runs/<run-id> --json
node skills/stack-provision/scripts/provision.mjs review .omc/provisioned/runs/<run-id> --critic-verdict=approve --research-ack --json
node skills/stack-provision/scripts/provision.mjs promote .omc/provisioned/runs/<run-id> --skill-root ~/.codex/skills/omc-provisioned --json
node skills/stack-provision/scripts/provision.mjs verify .omc/provisioned/runs/<run-id> --json
```

Only approve candidates that meet Strict Gate:

- `source_trust >= 0.85`
- `freshness_days <= 180`
- checksum valid
- license without conflict
- review gate approved
- critic verdict is `approve`

Untrusted or generated candidates stay in quarantine until manual review.

### Phase 8 - Build Handoff

Produce a foundation summary with:

- vision/spec artifact paths.
- competitor landscape path.
- constitution path.
- product capability map path.
- meaning graph path.
- ecosystem map path.
- opportunities path.
- rolling roadmap path.
- technology ADR path.
- provisioning manifest path.
- recommended first feature sequence.
- whether to start with `backend-pipeline`, `product-pipeline`, or both.

Before user-facing build, run `/product-experience-gate "<core product slice>"` and require `.omc/experience/current.md` to pass. This gate must cover user journey, empty states, failure states, return session, and perceived value.

Default routing:

- Foundation-lite: start with `/product-pipeline "<core product slice>"`; run `/backend-pipeline "<enabling task>"` only when the selected slice needs persistence, import/export, API, auth, jobs, or integrations.
- Foundation-full backend-heavy capability, data model, API, auth, billing, jobs, integrations: `/backend-pipeline "<feature>"`
- Foundation-full user-facing flow, interaction, visual system, copy, onboarding, dashboards: `/product-pipeline "<feature>"`
- Both surfaces: run the smallest dependency first, then the user-facing product surface. For empty apps, keep the user loop visible in the first cycle.

## State And Handoff Rules

- The orchestrator is the only role that updates pipeline state.
- `brand-architect` writes `.omc/brand/**` and `.omc/meaning/**`.
- `product-strategist` is read-only for code and writes only `.omc/strategy/**` for feature gates or `.omc/product/capability-map/**` for capability-map mode.
- `product-ecosystem-architect` writes only `.omc/ecosystem/**`.
- `priority-engine` writes only `.omc/portfolio/**`, `.omc/opportunities/**`, and `.omc/roadmap/**`.
- `technology-strategist`, researcher, and critic are read-only for code and write only `.omc/decisions/**`, `.omc/handoffs/**`, `.omc/artifacts/**`, or `.omc/audits/**` as appropriate.
- `stack-provision` writes only `.omc/provisioned/**` before approval and `~/.codex/skills/omc-provisioned/**` after approval.
- Every primary artifact MUST end with a YAML Handoff Envelope v2 block. Legacy XML `<handoff>` tags are deprecated and will be rejected by the orchestrator.

## Output

Terminal summary plus pointers:

```markdown
## Product Foundation Report

**Status:** ready-for-first-loop | ready-for-build | halted | needs-research | needs-human-decision

### Foundation Artifacts
| Layer | Path | Status |
|---|---|---|
| Vision/spec | `.omc/specs/...` or `.omc/ideas/...` | ... |
| Competitors | `.omc/competitors/landscape/current.md` | ... |
| Constitution | `.omc/constitution.md` | ... |
| Meaning | `.omc/meaning/current.md` | ... |
| Capability map | `.omc/product/capability-map/current.md` | ... |
| Ecosystem | `.omc/ecosystem/current.md` | ... |
| Portfolio ledger | `.omc/portfolio/current.json` | ... |
| Opportunities | `.omc/opportunities/current.md` | ... |
| Roadmap | `.omc/roadmap/current.md` | ... |
| Technology ADR | `.omc/decisions/YYYY-MM-DD-technology-<slug>.md` or `not-run-foundation-lite` | ... |
| Provisioning | `.omc/provisioned/runs/<run-id>/manifest.json` or `not-run-foundation-lite` | ... |

### Recommended Build Order
1. `/product-experience-gate "<core product slice>"`
2. `/product-pipeline "<core product slice from priority-engine>"`
3. `/backend-pipeline "<enabling task if needed>"`
4. `/priority-engine "<next cycle after evidence>"`
```

## Failure Modes To Avoid

- Running product/backend implementation before brand, priority portfolio, and any required stack decisions are grounded.
- Running technology strategy or provisioning before opportunity + roadmap exist.
- Starting an empty app with backend-only schema work when a first usable loop is missing.
- Building user-facing work without an experience gate that proves the loop, empty states, failure states, return session, and perceived value.
- Letting Technology Strategist invent the product roadmap when a capability map is missing.
- Treating technology strategy as one-time setup. Re-run it whenever a new capability block appears.
- Provisioning from a stack list without the strategist's application-block context.
- Letting product-pipeline invent visual systems that contradict `.omc/constitution.md` or `.omc/brand/**`.
- Letting backend-pipeline choose infra/auth/payment technologies ad hoc during implementation.
- Accepting unknown compatibility on a critical path without researcher pass.
- Self-approving generated skills or external downloads.

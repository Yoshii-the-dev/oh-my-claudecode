# Product Orchestration Architecture

This document defines the OMC product-development route from a new product idea to implementation-ready backend and product pipelines.

Agent artifact hygiene, context budgets, role permissions, audit scoring, and same-repository fresh-start behavior are defined in `docs/AGENT-PIPELINE-GOVERNANCE.md`.

Canonical product artifact paths, owners, stages, and contract levels are generated from `src/product/pipeline-registry.ts` into `docs/generated/product-pipeline-registry.md`. Prefer updating the registry over manually duplicating path/count tables.

## Entry Points

| User intent | Command |
|---|---|
| Run a product learning cycle | `/product-cycle "<cycle goal>"` |
| Start a new product or major pivot | `/product-foundation "<idea or market/problem>"` |
| Clarify a vague product/problem | `/deep-interview "<vague idea>"` |
| Generate divergent feature/product hypotheses | `/ideate "<problem statement>"` |
| Research competitors and market whitespace | `/competitor-scout "<niche>"` |
| Synthesize constitution/brand philosophy | `/brand-steward --pre-mvp --deep` or `/brand-steward --deep` |
| Map product systems and launch capability blocks | `/product-strategist --capability-map "<scope>"` |
| Rank opportunity portfolio and choose next cycle | `/priority-engine "<cycle goal>"` |
| Run pre-build UX/experience gate | `/product-experience-gate "<core product slice>"` |
| Run divergent UI/UX creative loop | `/creative-loop "<core product slice>"` |
| Decide technology stack for approved capability blocks | `/prompts:technology-strategist "<scope>"` |
| Provision stack skills | `/stack-provision .omc/decisions/YYYY-MM-DD-technology-<slug>.md` |
| Build backend/engine capability | `/backend-pipeline "<feature>"` |
| Build user-facing product surface | `/product-pipeline "<feature>"` |

## Layering

OMC separates product development into eight layers:

0. **Product Cycle Control**
   - `product-cycle-controller`
   - output: `.omc/cycles/current.md`, `.omc/learning/current.md`
   - owns: the product learning loop `discover -> rank -> select -> spec -> build -> verify -> learn`, current cycle state, next action, and learning capture.

1. **Market/Product Discovery**
   - `deep-interview`
   - `ideate`
   - `competitor-scout`
   - output: `.omc/specs/**`, `.omc/ideas/**`, `.omc/competitors/**`

2. **Brand/Constitution**
   - `brand-steward`
   - `brand-architect`
   - output: `.omc/constitution.md`, `.omc/brand/**`, `.omc/meaning/current.md`

3. **Product Capability Mapping**
   - `product-strategist --capability-map`
   - output: `.omc/product/capability-map/**`
   - owns: MVP scope, product systems, launch readiness gates, backend/product split, 30/60/90 roadmap, deferred systems, and capability blocks for technology strategy.

4. **Ecosystem Architecture**
   - `product-ecosystem-architect`
   - output: `.omc/ecosystem/current.md`
   - owns: app surfaces, content loops, data loops, distribution loops, integrations, research loop, creator/community gates, and deeper-version paths for core features.

5. **Opportunity Portfolio**
   - `priority-engine`
   - output: `.omc/portfolio/current.json`, `.omc/portfolio/current.md`, `.omc/opportunities/current.md`, `.omc/roadmap/current.md`
   - owns: the machine-readable work-item ledger, 20-40 ranked candidate moves, and next-cycle selection: one core product slice, one enabling task, one learning/research task.

6. **Experience Gate**
   - `product-experience-gate`
   - output: `.omc/experience/current.md`
   - owns: pre-code user journey, empty states, failure states, return session, perceived value, and UX verdict for user-facing work.

7. **Creative Loop**
   - `creative-loop`
   - output: `.omc/design/creative-loop/current.json`, `.omc/design/**`
   - owns: meaning brief, inspiration ledger, visual expectation contract, divergent visual hypotheses, motion grammar, design tokens, component experiments, screenshots, visual verdicts, and taste gate before visual implementation.

8. **Technology/Capability Governance**
   - `technology-strategist`
   - researcher alias: `document-specialist`
   - `critic`
   - `stack-provision`
   - output: `.omc/decisions/**`, `.omc/provisioned/**`
   - owns: concrete technology choices, weighted scorecards, compatibility, risk, and skill provisioning targets.

9. **Execution Pipelines**
   - `backend-pipeline`
   - `product-pipeline`
   - output: source changes, `.omc/handoffs/**`, `.omc/audits/**`

Lower layers consume upper-layer artifacts. They do not re-invent them.

## Canonical New-Product Route

```text
/product-cycle "<cycle goal>"
  discover: product-foundation --foundation-lite or minimum missing discovery
  rank: priority-engine
  select: one core product slice + one enabling task + one learning task
  spec: cycle spec + product-experience-gate before user-facing build
  build: creative-loop for visual UI work, then product-pipeline and/or backend-pipeline
  verify: tests, audits, acceptance evidence
  learn: .omc/learning/current.md, product-totality audit, capability graph, scenario coverage, product regression, and next-cycle adjustment
```

`/product-foundation`, `/priority-engine`, `/product-pipeline`, and `/backend-pipeline` remain valid specialist entrypoints. For product capability development, `/product-cycle` is the default route because it preserves the learning loop and resumable cycle state.

For pre-MVP products, `foundation-lite` is the default. The brand layer may be hypothesis-grade (`status: partial`) but must still be explicit. Competitor and research gaps lower confidence; they do not license generic brand, roadmap, or stack decisions.

Foundation-lite stops after opportunity + roadmap + first usable loop unless a concrete ADR is required to build that loop. Foundation-full is explicit or traction-driven and runs stack strategy after priority-engine.

Before any build or stack handoff, run the product contract validator:

```bash
omc doctor product-contracts --stage foundation-lite
```

Use `--stage priority-handoff` after a standalone `/priority-engine` pass, `--stage cycle` before build, `--stage technology-handoff` before a technology ADR, and `--stage all` for a full product artifact audit.

`priority-handoff` also enforces carry-forward from existing product audits: unresolved product-regression debts, scenario-coverage gaps, and product-totality gaps/recommended moves must appear in `.omc/portfolio/current.json` or `.omc/roadmap/current.md`. Ignored audit debt fails with `priority-ignores-regression-debt`, `priority-ignores-scenario-gap`, `priority-ignores-totality-gap`, or `priority-ignores-totality-move`.

## Product Cycle Controller Rules

Product Cycle Controller is the normal product-development entrypoint. It owns the state machine, not the specialist outputs.

Runtime FSM commands:

```bash
omc product-cycle status
omc product-cycle next
omc product-cycle validate
omc feature-generation audit --write --goal "<cycle goal>"
omc product-totality audit --write
omc scenario-generator generate --write
omc scenario-coverage audit --write
omc product-regression audit --write
omc product-cycle advance --to discover --goal "<cycle goal>"
omc product-cycle advance --to build
```

Run quality scorecard:

```bash
omc run-scorecard
omc historical-scorecard
omc product-totality audit --write
```

The scorecard reports downstream accepted handoffs, rework rate, artifact bloat, time-to-first-usable-loop, user-visible/infrastructure ratio, evidence/confidence coverage, and research-vs-invention routing.

The totality audit reports the product body itself: completed capabilities, how they are connected, whether they remain v0 seeds, which capability graph edges exist, which `orphan_capabilities` are disconnected, which scenario coverage gaps remain, which regression debts are carried, and which v1/v2 depth moves should feed the next priority pass.

Validate and project the portfolio ledger:

```bash
omc portfolio migrate --write   # for legacy .omc/opportunities/current.md without a ledger
omc portfolio validate
omc portfolio project --write
```

It must:

- write `.omc/cycles/current.md` for the active cycle.
- enforce stage order: discover -> rank -> select -> spec -> build -> verify -> learn.
- route discovery gaps to `product-foundation --foundation-lite` or the minimum missing discovery skill.
- route ranking to `priority-engine`.
- select exactly one core product slice, one enabling task, and one learning/research task from `.omc/portfolio/current.json`.
- write a cycle spec with acceptance criteria, build route, verification plan, learning plan, and feature expectation contract before build.
- run `/product-experience-gate` for user-facing work and require `.omc/experience/current.md` before build.
- run `omc doctor product-contracts --stage cycle` before build.
- write `.omc/learning/current.md` before marking the cycle complete.
- write `.omc/product/totality/current.json`, `.omc/product/totality/current.md`, `.omc/product/capability-graph/current.json`, `.omc/product/capability-graph/current.md`, `.omc/product/scenarios/current.json`, `.omc/product/scenarios/current.md`, `.omc/product/scenario-coverage/current.json`, `.omc/product/scenario-coverage/current.md`, `.omc/product/regression/current.json`, and `.omc/product/regression/current.md` when advancing `learn -> complete`.
- read the latest totality audit, capability graph, generated scenarios, scenario coverage, and regression audit before the next `/priority-engine` ranking pass.

It must not:

- implement code directly.
- create a second roadmap that competes with `.omc/opportunities/current.md` and `.omc/roadmap/current.md`.
- allow direct build from vague product intent.
- declare success after verification while skipping learning capture.
- start a new cycle from learning alone while ignoring the aggregate product body.

## Product Totality Rules

Product Totality is the post-cycle aggregate audit. It exists because a completed cycle may only seed a capability; it does not prove the capability is mature, connected, or beautiful as part of the product.

It reads completed cycles, learning, portfolio, roadmap, ecosystem, meaning, experience, and creative-loop evidence, then writes:

- `.omc/product/totality/current.json`
- `.omc/product/totality/current.md`
- `.omc/product/capability-graph/current.json`
- `.omc/product/capability-graph/current.md`
- `.omc/product/scenarios/current.json`
- `.omc/product/scenarios/current.md`
- `.omc/product/scenario-coverage/current.json`
- `.omc/product/scenario-coverage/current.md`
- `.omc/product/regression/current.json`
- `.omc/product/regression/current.md`

It scores:

- `composition`: whether the product has a body beyond isolated controls.
- `connectedness`: whether capabilities connect to learning, roadmap, ecosystem, meaning, and visual evidence.
- `freedom`: whether the portfolio has enough lanes and future moves without collapsing into one rigid path.
- `depth`: whether completed capabilities progress beyond v0.
- `complexity_fit` / `beauty_fit`: whether the current degree of complexity is meaningful rather than too simple or support-heavy.

If the status is `under-composed`, `under-connected`, or `needs-depth`, the next `/priority-engine` pass must include the audit's `recommended_moves` as candidate portfolio work.

## Capability Graph Rules

Capability Graph is written by `omc product-totality audit --write`. It converts completed capabilities into nodes and links them to learning captures, portfolio work, roadmap/ecosystem/meaning context, visual evidence, missing maturity-depth nodes, and adjacent completed capabilities.

It exists to prevent useful-looking but disconnected work from being forgotten. If `.omc/product/capability-graph/current.json` contains `orphan_capabilities`, the next `/priority-engine` pass must either:

- select a reconnection/depth move for the orphan capability; or
- explain why another candidate has stronger evidence and preserve the orphan as roadmap debt.

## Scenario Generator Rules

Scenario Generator is written by `omc scenario-generator generate --write`. It converts `feature_expectation_contract` into a concrete return-session proof loop:

```text
setup/open context -> first meaningful use -> core action -> state change -> exit/restart -> return -> continue with context -> prove useless_if is false
```

It writes:

- `.omc/product/scenarios/current.json`
- `.omc/product/scenarios/current.md`

Generated scenarios are declarations, not proof. They become proof only after runtime QA, simulator, or explicit dogfood evidence runs and writes `.omc/handoffs/runtime-qa/current.json` or equivalent learning evidence.

## Scenario Coverage Rules

Scenario Coverage is written by `omc scenario-coverage audit --write`. It maps each completed capability to the first meaningful user loop from the feature expectation contract and generated scenario declarations, then checks whether runtime QA, simulator, or explicit dogfood evidence proves that loop.

Coverage levels:

- `missing`: no executable or declared scenario evidence exists.
- `declared`: a scenario or runtime QA flow exists, but it has not run.
- `runtime-passed`: executable evidence proves the scenario.
- `runtime-failed`: runtime QA failed, blocked, or only partially passed.
- `dry-run` / `stale`: evidence is not current enough to prove the capability.

If `.omc/product/scenario-coverage/current.json` is not `covered`, the next `/priority-engine` pass must include scenario proof as quality/learning work before treating the capability as mature.

## Product Regression Rules

Product Regression is written by `omc product-regression audit --write`. It compares completed cycles against learning captures, product totality, scenario coverage, and historical scorecard regressions.

Regression debt categories:

- `learning`: completed cycles without learning or learning recommendations not carried forward.
- `capability-depth`: missing v1/v2/not-done-until depth.
- `orphan`: capability graph isolation.
- `scenario-proof`: runtime QA/simulator/dogfood proof gaps.
- `quality-regression`: historical scorecard regressions.
- `evidence`: missing feature expectation or weak completion proof.

If `.omc/product/regression/current.json` is not `stable`, the next `/priority-engine` pass must include the audit's debts as candidate work or explicit roadmap debt.

The priority handoff validator enforces this: `omc doctor product-contracts --stage priority-handoff` fails when regression, scenario, or totality audit debt exists but is not carried into `.omc/portfolio/current.json` or `.omc/roadmap/current.md`.

## Experience Gate Rules

User-facing work must pass a UX/experience gate before code. The gate catches cases where a schema, engine, or backend contract is correct but the user cannot complete a meaningful loop.

It must produce `.omc/experience/current.md` with:

- user journey.
- empty states.
- failure states.
- return-session behavior.
- perceived value.
- UX verdict: `pass`, `blocked`, or `needs-research`.

The cycle contract blocks build when this artifact is missing or does not pass.

## Feature Expectation Contract Rules

User-facing core slices must also declare what the feature is expected to become, not just what control will be implemented first. The selected core item in `.omc/portfolio/current.json` must include `feature_expectation`, and `.omc/cycles/current.md` must include `feature_expectation_contract` with:

- `user_job`
- `first_meaningful_use`
- `useless_if`
- `maturity_ladder.v0`, `maturity_ladder.v1`, and `maturity_ladder.v2`
- `not_done_until`

This prevents a seeded v0 control from being treated as a finished feature. If the next build only ships `v0`, the roadmap must keep `v1/v2` as capability depth rather than marking the capability done.

## Product Capability Map Rules

Product Strategist owns the missing middle between brand philosophy and build pipelines. It answers "what product systems must exist for this to be launchable and competitive?" before technology choices are made.

It must produce `.omc/product/capability-map/YYYY-MM-DD-<slug>.md` and refresh `.omc/product/capability-map/current.md`.

The map must include:

- MVP feature set and market-winning differentiators.
- first usable loop candidates.
- required product systems: auth, onboarding, analytics, telemetry, admin/support, billing, content/data workflows, domain-specific engines, and retention/growth loops.
- launch readiness gates.
- backend/product pipeline split.
- capability blocks for `technology-strategist` when foundation-full is needed.
- roadmap signals for `priority-engine`.
- deferred systems with revisit triggers.
- a handoff to `technology-strategist`.

It must not:

- select concrete technologies, vendors, SDKs, or libraries.
- install or provision skills.
- generate a one-feature-only roadmap when the user is trying to build a product.
- recommend backend-only schema/package work as the product result for an empty app.
- read legacy product source during `--fresh-start` except as explicitly whitelisted reference.

## Priority Engine Rules

Priority Engine is the living portfolio layer between discovery and execution. It consumes the capability map, totality audit, capability graph, generated scenarios, scenario coverage, product regression, meaning graph, ecosystem map, research, competitors, classifications, and `.omc/feature-generation/current.json`.

It must:

- write `.omc/portfolio/current.json` as the compact source of truth for work items.
- optionally write `.omc/portfolio/current.md` as a human-readable projection.
- produce 20-40 candidate moves across product, UX, research, backend, quality, brand/content, and distribution.
- consume or request `omc feature-generation audit --write --goal "<cycle goal>"` so feature generation is based on explicit source coverage and MCP readiness.
- consume or request `omc product-totality audit --write`, `omc scenario-generator generate --write`, `omc scenario-coverage audit --write`, and `omc product-regression audit --write` after completed cycles so existing capability depth, orphan reconnection, generated scenario proof, and regression debt compete with brand-new ideas.
- give every work item a stable `id`, `lane`, `status`, `confidence`, `dependencies`, `selected_cycle`, and `evidence`.
- give the selected core product slice a `feature_expectation` contract with first meaningful use, useless-if conditions, maturity ladder, and not-done-until gates.
- score candidates by user value, evidence, learning value, dependency unlock, ecosystem depth, effort fit, and risk reduction.
- select exactly one core product slice, one enabling task, and one learning/research task for the next cycle.
- treat weak evidence as research debt: create a selected learning/research item and keep it in the rolling roadmap as a learning gate.
- write `.omc/opportunities/current.md`.
- write `.omc/roadmap/current.md` as a rolling 2/6/12-week roadmap.
- keep pre-MVP work centered on a first usable loop.
- keep missing source/MCP setup visible as a selected learning/research task when it affects the selected cycle.
- keep product-totality, capability-graph, generated scenario, scenario-coverage, and product-regression gaps visible as `capability depth`, `connection gate`, `orphan capability`, `scenario declaration`, `scenario proof`, `regression debt`, or `learning gate` in `.omc/roadmap/current.md`.
- carry unresolved audit debt into `.omc/portfolio/current.json` or `.omc/roadmap/current.md`; the priority handoff gate rejects ignored regression, scenario, and totality debt.
- pass `omc portfolio validate` before downstream handoff.
- pass `omc doctor product-contracts --stage priority-handoff` before downstream handoff.

It must not:

- rank only a few large features.
- route to technology ADR/provisioning before opportunity + roadmap exist.
- let pure infrastructure outrank a missing user-visible loop unless it directly unlocks that loop.
- treat the 12-week roadmap as fixed.

## Technology Strategy Rules

Technology Strategist is not a package recommender and not the product roadmap owner. It consumes the capability map plus priority-engine outputs and converts selected product systems into concrete stack decisions, compatibility judgments, risks, and skill/provisioning targets.

It must:

- classify domain and monetization/engagement model.
- consume `.omc/product/capability-map/current.md` when present.
- consume `.omc/opportunities/current.md` and `.omc/roadmap/current.md` before pre-MVP ADR/provisioning.
- infer missing application blocks only to challenge or complete the map, not to silently replace it.
- explicitly evaluate retention/growth systems: analytics, experimentation, lifecycle messaging, in-app guidance, referrals, gamification, retention modeling, session replay, personalization, NPS/feedback, segmentation.
- separate concrete stack technologies from product capability blocks.
- compute the fixed weighted score:
  - Product Fit: 30%
  - Operability: 20%
  - Ecosystem Maturity: 20%
  - Performance: 15%
  - Security/Compliance: 10%
  - Cost: 5%
- produce pairwise compatibility for `auth`, `analytics`, `telemetry`, `frontend-core`, `backend-core`, and `integration-layer`.
- write a structured output JSON sidecar per `docs/schemas/agent-output.schema.json`.

It must not:

- assume the first stack is permanent.
- skip auth/analytics/telemetry/operations because the user did not mention them.
- pass granular product blocks directly into `stack-provision --blocks` unless they map to canonical blocks.
- send anything to `stack-provision` when compatibility is `blocked`.

## Dynamic Routing

| Signal | Route |
|---|---|
| `requirements_completeness < 0.75` | `deep-interview` |
| `unknown_critical_inputs >= 2` | `deep-interview` |
| `top2_score_gap < 8` | `document-specialist` researcher |
| critical compatibility is `unknown` | `document-specialist` researcher |
| fresh external evidence is missing for key technology | `document-specialist` researcher |
| product request lacks active cycle/spec | `product-cycle-controller` |
| opportunity/roadmap missing before technology ADR | `priority-engine` |
| critic `approve` | `stack-provision` |
| critic `revise` | back to `technology-strategist` |
| critic `rewind` | hard rewind to `product-strategist --capability-map`; invalidate downstream technology/provision artifacts |
| rewind count > 2 | `deep-interview` + human decision gate |

## Stack Provisioning Rules

`stack-provision` is Strict Gate by default:

- no install before critic approval.
- no install if source trust `< 0.85`.
- no install if freshness exceeds 180 days.
- no install without checksum.
- no install with license conflict.
- generated skills are fallback only and stay marked with generated provenance.
- untrusted candidates stay in `.omc/provisioned/runs/<run-id>/quarantine`.

## Feature Pipeline Integration

`backend-pipeline` and `product-pipeline` include conditional technology preflight:

- backend: Stage 3.5, after requirements and before architecture.
- product: Stage 2.5, after strategic gate and before UX research/flow design.

Skip this preflight only when a current ADR and verified provisioning manifest explicitly cover the feature's capability blocks.

## Visual Product Quality

For user-facing surfaces, `product-pipeline` must treat the brand and visual layer as first-class:

- read `.omc/constitution.md` and `.omc/brand/**`.
- prefer original visual concepts grounded in brand philosophy, competitor whitespace, and product meaning.
- run `/creative-loop "<core product slice>"` before implementation when the surface needs distinctive UI/UX, motion, visual language, generated assets, or brand expression.
- verify `omc creative-loop audit --write --goal "<core product slice>"` reports `ready`.
- provision visual-creative skills when the feature needs motion, generated imagery, 3D, illustration, iconography, typography exploration, or visual QA.
- avoid generic UI defaults that contradict the constitution.

Creative loop artifacts:

- `.omc/design/meaning-brief/current.md`
- `.omc/design/inspiration-ledger/current.md`
- `.omc/design/visual-expectation/current.json`
- `.omc/design/directions/current.md`
- `.omc/design/motion-grammar/current.md`
- `.omc/design/tokens/current.json`
- `.omc/design/component-experiments/current.json`
- `.omc/design/taste-gate/current.md`
- `.omc/design/system/current.md` only after taste gate pass

The visual expectation contract is the bridge between art direction and implementation. It must name desired perception, category codes to avoid, selected direction, token rationale, component proofs, screenshot evidence, and `not_ready_if` conditions. This prevents token extraction or a single attractive mock from being treated as a complete external look.

## Handoff And Permissions

The orchestrator owns state. Agents write artifacts.

| Role | Read | Write |
|---|---|---|
| Orchestrator | state and envelopes | `.omc/state/**`, `.omc/handoffs/**` |
| Product Cycle Controller | current product artifacts and cycle state | `.omc/cycles/**`, `.omc/learning/**`, `.omc/product/totality/**`, `.omc/product/capability-graph/**`, `.omc/product/scenarios/**`, `.omc/product/scenario-coverage/**`, `.omc/product/regression/**`, `.omc/handoffs/**` |
| Product Strategist | compact product/market/brand context read-only | `.omc/strategy/**`, `.omc/product/capability-map/**` |
| Technology Strategist | compact product context and code/config read-only | `.omc/decisions/**`, `.omc/handoffs/**` |
| Researcher | docs/external/context read-only | `.omc/artifacts/**`, `.omc/handoffs/**` |
| Critic | upstream artifacts read-only | `.omc/audits/**`, `.omc/handoffs/**` |
| Stack Provision | run contract/review/provision files | `.omc/provisioned/**`, approved skill root |
| Backend/Product pipelines | approved plans and code | scoped source/test files |

All pipeline agents write `.output.json` sidecar files per `docs/schemas/agent-output.schema.json`. The orchestrator reads these JSON files for routing. Invalid or missing structured outputs are surfaced and corrected before the next agent runs.

## Practical Command Sequence

```bash
/product-cycle "ship first usable knitting companion loop"
```

For a major pivot in the same repository:

```bash
/product-cycle "fresh-start first usable knitting companion loop" --new-cycle
```

When a foundation-only reset is explicitly needed:

```bash
/product-foundation "AI-native knitting companion for advanced hobbyists" --fresh-start --pre-mvp --deep-brand
```

For an already-running project with a new capability:

```bash
/product-cycle "add subscription billing activation and lifecycle loop"
```

For an already-approved, fully specified backend-only task, use the lower-level pipeline directly:

```bash
/backend-pipeline "add subscription billing with Stripe, invoices, dunning, and audit trail"
```

The pipeline will run the technology preflight only if existing ADR/provisioning does not cover those blocks.

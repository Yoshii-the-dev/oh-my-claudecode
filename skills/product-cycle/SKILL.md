---
name: product-cycle
description: Run the OMC product learning loop as one controlled cycle: discover -> rank -> select -> spec -> build -> verify -> learn. Use instead of jumping directly between product-foundation, priority-engine, product-pipeline, and backend-pipeline when developing product capabilities.
argument-hint: "\"<cycle goal>\" [--new-cycle] [--resume] [--stage discover|rank|select|spec|build|verify|learn]"
level: 4
---

# Product Cycle

Use this skill as the default product-development controller. It turns scattered product skills into one explicit learning loop:

```text
discover -> rank -> select -> spec -> build -> verify -> learn
```

The controller does not replace existing skills. It routes them in order and writes the cycle state that makes the work resumable and measurable.

Runtime guardrail: use the CLI FSM to inspect and advance stage state. The skill owns product reasoning; the CLI owns legal transitions.

Portfolio guardrail: cycle selection comes from `.omc/portfolio/current.json`. `.omc/opportunities/current.md` and `.omc/roadmap/current.md` explain the ledger for humans, but the JSON ledger is the compact machine-readable source.

## Usage

```bash
/product-cycle "ship first usable knitting reader loop"
/oh-my-claudecode:product-cycle "choose and build next activation cycle"
/product-cycle "improve onboarding activation" --new-cycle
/product-cycle "resume current product cycle" --resume
```

Runtime FSM commands:

```bash
omc product-cycle status
omc product-cycle next
omc product-cycle validate
omc product-cycle run --auto --auto-policy safe --json
omc feature-generation audit --write --goal "ship first usable loop"
omc creative-loop audit --write --goal "ship first usable loop"
omc creative-loop lifecycle --write --goal "ship first usable loop"
omc product-totality audit --write
omc scenario-generator generate --write --apply-runtime-qa
omc scenario-coverage audit --write
omc product-regression audit --write
omc capability-lifecycle audit --write
omc product-cycle advance --to discover --goal "ship first usable loop"
omc product-cycle advance --to build
```

## Use When

- The user asks for a new product capability, feature sequence, or product improvement.
- There are multiple possible entrypoints and the next product step is unclear.
- The app is empty/pre-MVP and needs a first usable loop.
- You need development to end with learning, not just code changes.

Do not use this for narrow bug fixes, pure refactors, one-off documentation, or already-approved implementation tasks with a complete spec.

## Controller Agent

Invoke `product-cycle-controller` with the cycle goal and any requested flags.

The controller owns:

- `.omc/cycles/current.md`
- `.omc/cycles/YYYY-MM-DD-<slug>.md`
- `.omc/learning/current.md`
- `.omc/learning/YYYY-MM-DD-<slug>.md`

It routes existing skills:

| Cycle stage | Route |
|---|---|
| discover | `omc feature-generation audit --write --goal "<goal>"`, then `/product-foundation "<goal>" --foundation-lite` or the minimum missing discovery skill |
| rank | `omc feature-generation audit --write --goal "<cycle goal>"`, then `/priority-engine "<cycle goal>"` |
| select | controller confirms the selected-cycle trio from `.omc/portfolio/current.json` |
| spec | controller writes cycle spec and runs `/product-experience-gate` |
| build | `/creative-loop` for visual UI work, then `/product-pipeline` and/or `/backend-pipeline` |
| verify | relevant tests, audits, verifier |
| learn | controller writes `.omc/learning/current.md`, writes `.omc/product/totality/current.json`, `.omc/product/capability-graph/current.json`, `.omc/product/scenario-coverage/current.json`, and `.omc/product/regression/current.json`, then marks cycle complete |

## Protocol

1. Read `.omc/cycles/current.md`.
2. If an active incomplete cycle exists, resume it unless `--new-cycle` is explicit.
3. If no active cycle exists, create one with `cycle_stage: discover`.
4. Execute only the next valid stage. Do not skip ahead.
   - For autonomous execution, prefer `omc product-cycle run --auto --auto-policy safe --json`.
   - `--auto` may continue safe executable research/build/verify handoffs and must stop at human gates, missing dependency/provisioning approval, repeated failure, or max attempts.
   - At discover/rank, `omc feature-generation audit --write --goal "<cycle goal>"` records source coverage and MCP setup gaps before priority ranking.
   - Check the stage with `omc product-cycle status`.
   - Ask for the next legal action with `omc product-cycle next`.
   - Use `omc product-cycle advance --to <stage>` only for explicit manual/inspection workflows after the stage exit criteria pass.
5. After rank, run:

```bash
omc portfolio validate
omc doctor product-contracts --stage priority-handoff
```

6. If a human-readable projection is stale or missing, run:

```bash
omc portfolio project --write
```

For mechanical projection drift across cycle, learning, and portfolio artifacts,
prefer the repair command instead of hand-editing generated Markdown:

```bash
omc product-cycle repair --safe
```

This may re-render Markdown projections from typed JSON, but it must not change
cycle stage, selected work, acceptance criteria, or runtime QA evidence.

7. For user-facing work, run the pre-code experience gate:

```bash
/product-experience-gate "<core product slice>"
```

It must write `.omc/experience/current.md` with user journey, empty states, failure states, return session, perceived value, and a pass/block verdict.

Before build, the cycle spec must also include `feature_expectation_contract`:

- `user_job`
- `first_meaningful_use`
- `useless_if`
- `maturity_ladder` with `v0`, `v1`, and `v2`
- `not_done_until`

If the build only delivers `v0`, call the result a seeded capability and keep `v1/v2` visible in the roadmap instead of marking the whole feature done.

8. Generate scenario declarations before build:

```bash
omc scenario-generator generate --write --apply-runtime-qa
```

This writes `.omc/product/scenarios/current.json` and `.omc/product/scenarios/current.md` from `feature_expectation_contract`. When a Playwright, Maestro, dogfood, simulator, or project-script harness is detected, it also merges generated `runtime_qa_flow` declarations into `.omc/runtime-qa.json`. The generated loop must include setup/open context, core action, exit/restart, return-session, continue-with-context, and proof that `useless_if` is false.

9. For user-facing visual work, run the creative loop before implementation:

```bash
/creative-loop "<core product slice>"
omc creative-loop audit --write --goal "<core product slice>"
omc creative-loop lifecycle --write --goal "<core product slice>"
```

It must prove meaning brief, inspiration ledger, visual expectation contract, 3-5 divergent design directions, motion grammar, tokens, component experiments/screenshots, visual verdict, taste gate, and visual lifecycle phases: visual hypothesis, implementation mapping, screenshot proof, and iteration debt. Draft placeholders from `omc creative-loop init` do not pass.

10. After spec, run:

```bash
omc doctor product-contracts --stage cycle
```

11. Build only after the cycle, experience, generated scenario, and required creative gates pass.
12. Verify with evidence from tests/audits/acceptance criteria.
    - When `.omc/runtime-qa.json` exists or the verification plan declares runtime smoke/simulator coverage, run `omc runtime-qa run --auto --json` and include `.omc/handoffs/runtime-qa/current.json` as evidence.
    - If `omc doctor runtime-qa --json` reports `runtime-qa-fixture-agent-mcp-required`, invoke the `runtime-qa` skill to prepare the Supabase MCP disposable fixture before running destructive simulator flows.
    - Mobile simulator tooling is explicit opt-in: if Maestro/Detox/Appium is missing, rerun with `omc runtime-qa run --auto --install-mobile-tools --json` only after the user has approved provisioning. Product-cycle may pass the same approval with `omc product-cycle run --auto --install-mobile-tools --json`.
13. Learn before completion: write `.omc/learning/current.md`. Advancing `learn -> complete` must also write `.omc/product/totality/current.json`, `.omc/product/totality/current.md`, `.omc/product/capability-graph/current.json`, `.omc/product/capability-graph/current.md`, `.omc/product/scenarios/current.json`, `.omc/product/scenarios/current.md`, `.omc/product/scenario-coverage/current.json`, `.omc/product/scenario-coverage/current.md`, `.omc/product/regression/current.json`, `.omc/product/regression/current.md`, `.omc/product/capability-lifecycle/current.json`, and `.omc/product/capability-lifecycle/current.md`, then set `cycle_stage: complete`.
14. Before the next ranking pass, read `.omc/product/totality/current.json`, `.omc/product/capability-graph/current.json`, `.omc/product/scenarios/current.json`, `.omc/product/scenario-coverage/current.json`, `.omc/product/regression/current.json`, and `.omc/product/capability-lifecycle/current.json`. Treat completed core slices as seeded capabilities unless the lifecycle audit says `mature`; feed seeded/proving/remove-candidate lifecycle decisions into `/priority-engine`.

## Cycle Artifact Contract

`.omc/cycles/current.md` must include:

- `cycle_id`
- `cycle_stage`
- all stage names: discover, rank, select, spec, build, verify, learn
- selected portfolio:
  - `core_product_slice`
  - `enabling_task`
  - `learning_task`
- portfolio source: `.omc/portfolio/current.json` selected item ids
- acceptance criteria
- build route
- verification plan
- learning plan
- experience gate path: `.omc/experience/current.md`
- feature expectation contract: `user_job`, `first_meaningful_use`, `useless_if`, `maturity_ladder.v0/v1/v2`, `not_done_until`
- totality audit path after completion: `.omc/product/totality/current.json`
- capability graph path after completion: `.omc/product/capability-graph/current.json`
- scenario coverage path after completion: `.omc/product/scenario-coverage/current.json`
- regression audit path after completion: `.omc/product/regression/current.json`
- standard footer fields: `status`, `evidence`, `confidence`, `blocking_issues`, `next_action`, `artifacts_written`

## Rules

- Product work should enter through `/product-cycle` unless the user explicitly asks for a lower-level skill.
- `/product-foundation`, `/priority-engine`, `/product-pipeline`, and `/backend-pipeline` remain valid specialist commands, but the controller is the normal route for product capability development.
- Empty/pre-MVP cycles must keep the first usable loop visible in the selected core slice.
- Backend work can be selected as the enabling task, but not as a substitute for the core product slice when no usable loop exists.
- User-facing work cannot enter build until `.omc/experience/current.md` passes the user journey, empty states, failure states, return session, and perceived value checks.
- User-facing core slices cannot enter build until `feature_expectation_contract` names the first meaningful use, what would make the implementation useless, and the v0/v1/v2 maturity ladder.
- Visual user-facing work cannot enter build until `.omc/design/visual-expectation/current.json` names desired perception, category codes to avoid, selected direction, token rationale, component proofs, screenshot evidence, and not-ready-if conditions.
- Visual user-facing work cannot enter implementation until the creative-loop audit is ready and `.omc/design/taste-gate/current.md` has a real `verdict: pass`.
- Visual user-facing work cannot be called visually complete until `.omc/design/visual-lifecycle/current.json` is `healthy` or carries only explicit watchlist debt.
- Weak evidence must create a selected learning/research task and remain visible as research debt in the roadmap.
- A cycle is not done until learning is captured.
- A completed cycle is not the end of a capability. After completion, totality audit must evaluate what exists, how it is connected, and which v1/v2 depth remains.
- The capability graph must expose orphan capabilities that have no learning, portfolio, system, or adjacent-capability edges.
- Scenario coverage must prove the first meaningful user loop through runtime QA, simulator, or dogfood evidence.
- Product regression must preserve learning debt and completion debt across cycles.
- The next cycle must consider totality gaps, `orphan_capabilities`, scenario coverage gaps, and regression debts before ranking new ideas.

## Failure Modes To Avoid

- Calling `product-pipeline` directly from a vague product idea.
- Producing discovery and roadmap artifacts without selecting one cycle.
- Building before the cycle spec exists.
- Verifying code but skipping user/product learning.
- Starting a new cycle from learning alone without checking aggregate product totality.
- Creating a second roadmap inside the cycle artifact instead of linking to `.omc/opportunities/current.md` and `.omc/roadmap/current.md`.

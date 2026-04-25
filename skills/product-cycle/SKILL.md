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
| discover | `/product-foundation "<goal>" --foundation-lite` or the minimum missing discovery skill |
| rank | `/priority-engine "<cycle goal>"` |
| select | controller confirms the selected-cycle trio from `.omc/portfolio/current.json` |
| spec | controller writes cycle spec and runs `/product-experience-gate` |
| build | `/product-pipeline` and/or `/backend-pipeline` |
| verify | relevant tests, audits, verifier |
| learn | controller writes `.omc/learning/current.md` and marks cycle complete |

## Protocol

1. Read `.omc/cycles/current.md`.
2. If an active incomplete cycle exists, resume it unless `--new-cycle` is explicit.
3. If no active cycle exists, create one with `cycle_stage: discover`.
4. Execute only the next valid stage. Do not skip ahead.
   - Check the stage with `omc product-cycle status`.
   - Ask for the next legal action with `omc product-cycle next`.
   - Advance with `omc product-cycle advance --to <stage>` after the stage exit criteria pass.
5. After rank, run:

```bash
omc portfolio validate
omc doctor product-contracts --stage priority-handoff
```

6. If a human-readable projection is stale or missing, run:

```bash
omc portfolio project --write
```

7. For user-facing work, run the pre-code experience gate:

```bash
/product-experience-gate "<core product slice>"
```

It must write `.omc/experience/current.md` with user journey, empty states, failure states, return session, perceived value, and a pass/block verdict.

8. After spec, run:

```bash
omc doctor product-contracts --stage cycle
```

9. Build only after the cycle and experience gates pass.
10. Verify with evidence from tests/audits/acceptance criteria.
11. Learn before completion: write `.omc/learning/current.md`, then set `cycle_stage: complete`.

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
- standard footer fields: `status`, `evidence`, `confidence`, `blocking_issues`, `next_action`, `artifacts_written`

## Rules

- Product work should enter through `/product-cycle` unless the user explicitly asks for a lower-level skill.
- `/product-foundation`, `/priority-engine`, `/product-pipeline`, and `/backend-pipeline` remain valid specialist commands, but the controller is the normal route for product capability development.
- Empty/pre-MVP cycles must keep the first usable loop visible in the selected core slice.
- Backend work can be selected as the enabling task, but not as a substitute for the core product slice when no usable loop exists.
- User-facing work cannot enter build until `.omc/experience/current.md` passes the user journey, empty states, failure states, return session, and perceived value checks.
- Weak evidence must create a selected learning/research task and remain visible as research debt in the roadmap.
- A cycle is not done until learning is captured.

## Failure Modes To Avoid

- Calling `product-pipeline` directly from a vague product idea.
- Producing discovery and roadmap artifacts without selecting one cycle.
- Building before the cycle spec exists.
- Verifying code but skipping user/product learning.
- Creating a second roadmap inside the cycle artifact instead of linking to `.omc/opportunities/current.md` and `.omc/roadmap/current.md`.

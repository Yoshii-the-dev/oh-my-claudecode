---
name: product-totality
description: Audit the aggregate product body after one or more product cycles. Use after learn/complete and before priority-engine when the next cycle should be informed by what already exists, how it is connected, and what maturity depth is missing.
argument-hint: "\"<product or cycle context>\" [--write]"
level: 4
---

# Product Totality

Use this skill when a product has completed work and the next move should not be chosen from a flat backlog. It evaluates the aggregate product body:

```text
completed cycles + learning + portfolio + roadmap + ecosystem + meaning + visual evidence
```

The goal is to keep a seeded feature from being treated as finished. A product should become more composed, connected, free, and deep over cycles.

## Usage

```bash
/product-totality "review existing knitting app work before the next cycle"
omc product-totality audit --write
omc product-totality audit --json
```

## Inputs

Read compact/current artifacts first:

- `.omc/product/totality/current.json` when refreshing
- `.omc/product/capability-graph/current.json` when refreshing
- `.omc/product/scenarios/current.json` when refreshing
- `.omc/product/scenario-coverage/current.json` when refreshing
- `.omc/product/regression/current.json` when refreshing
- `.omc/cycles/current.json`
- `.omc/cycles/YYYY-MM-DD-<slug>.json|md`
- `.omc/learning/current.json`
- `.omc/learning/YYYY-MM-DD-<slug>.json|md`
- `.omc/portfolio/current.json`
- `.omc/roadmap/current.md`
- `.omc/opportunities/current.md`
- `.omc/ecosystem/current.md`
- `.omc/meaning/current.md`
- `.omc/experience/current.md`
- `.omc/design/visual-expectation/current.json`
- `.omc/design/taste-gate/current.md`

Do not scan implementation files by default. This audit is a product artifact audit, not a code review.

## Protocol

1. Run:

```bash
omc product-totality audit --write
omc scenario-generator generate --write
omc scenario-coverage audit --write
omc product-regression audit --write
```

2. Read `.omc/product/totality/current.json`.
3. Read `.omc/product/capability-graph/current.json`.
4. Read `.omc/product/scenarios/current.json`.
5. Read `.omc/product/scenario-coverage/current.json`.
6. Read `.omc/product/regression/current.json`.
7. Treat every completed core product slice as a seeded capability unless the audit proves deeper maturity.
8. For each capability, inspect:
   - maturity: `missing-expectation | seeded-v0 | contextual-v1 | systemic-v2`
   - missing depth from the feature expectation maturity ladder
   - connections to learning, roadmap, ecosystem, meaning, visual expectation, and taste gate
   - graph edges to other capabilities, source artifacts, portfolio work, and maturity-depth nodes
   - `orphan_capabilities` when a shipped capability is disconnected or still just a v0 seed
   - scenario coverage: whether the first meaningful user loop is `runtime-passed`
   - regression debts: whether learning, scenario proof, or quality regressions are still carried
   - recommended portfolio moves
9. If status is not `balanced`, route the highest-leverage recommended moves into `/priority-engine`.
10. If there are `error` gaps, repair those before ranking the next cycle.

## Output

- `.omc/product/totality/current.json` — machine-readable aggregate audit.
- `.omc/product/totality/current.md` — human-readable projection.
- `.omc/product/capability-graph/current.json` — machine-readable capability graph and orphan detector.
- `.omc/product/capability-graph/current.md` — graph projection with nodes, edges, and orphan reasons.
- `.omc/product/scenarios/current.json` — generated return-session scenario declarations.
- `.omc/product/scenarios/current.md` — generated scenario projection.
- `.omc/product/scenario-coverage/current.json` — machine-readable capability-to-scenario coverage audit.
- `.omc/product/scenario-coverage/current.md` — scenario coverage projection.
- `.omc/product/regression/current.json` — cross-cycle regression and learning debt audit.
- `.omc/product/regression/current.md` — regression projection.

The audit scores:

- `composition` — whether the product has a body beyond isolated controls.
- `connectedness` — whether capabilities are tied to learning, roadmap, ecosystem, meaning, and visual evidence.
- `freedom` — whether the portfolio has enough lanes and future moves without collapsing into one rigid path.
- `depth` — whether completed capabilities progress beyond v0.
- `complexity_fit` / `beauty_fit` — whether the selected degree of complexity is meaningful rather than too simple or support-heavy.

## Integration

- `/product-cycle` writes the totality audit, capability graph, scenario coverage, and regression audit when a cycle advances from `learn` to `complete`.
- `/product-cycle` writes generated scenario declarations before scenario coverage so coverage can distinguish declared-but-unrun scenarios from missing scenario design.
- `/priority-engine` must read totality, `orphan_capabilities`, generated scenarios, scenario coverage, and regression debts as inputs before ranking the next cycle.
- `omc feature-generation audit` counts totality, capability graph, scenario generator, scenario coverage, and regression as sources for future feature/opportunity generation.

## Failure Modes To Avoid

- Starting a new cycle from `.omc/learning/current.md` alone.
- Treating a completed v0 control as a finished capability.
- Selecting another backend/enabling task when totality says user-visible capability depth is missing.
- Creating a second roadmap inside this audit. Recommended moves feed the portfolio; they do not replace `.omc/portfolio/current.json`.

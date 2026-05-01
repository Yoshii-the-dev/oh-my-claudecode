---
name: product-regression
description: Audit cross-cycle product regressions, uncarried learning, and completion debt. Use after product-totality/scenario-coverage and before priority-engine when completed work must be compared against what was promised, learned, and actually proven.
argument-hint: "\"<product or cycle context>\" [--write]"
level: 4
---

# Product Regression

Use this skill when the product has completed cycles and the next move must account for unfinished expectations, uncarried learning, scenario proof gaps, and quality regressions.

It connects:

```text
historical cycles + learning + product totality + scenario coverage
```

## Usage

```bash
/product-regression "audit learning debt before the next knitting cycle"
omc product-regression audit --write
omc product-regression audit --json
```

## Inputs

Read compact/current artifacts first:

- `.omc/product/regression/current.json` when refreshing
- `.omc/product/totality/current.json`
- `.omc/product/capability-graph/current.json`
- `.omc/product/scenario-coverage/current.json`
- `.omc/cycles/current.json`
- `.omc/cycles/YYYY-MM-DD-<slug>.json|md`
- `.omc/learning/current.json`
- `.omc/learning/YYYY-MM-DD-<slug>.json|md`
- `.omc/portfolio/current.json`
- `.omc/roadmap/current.md`

## Protocol

1. Run:

```bash
omc product-totality audit --write
omc scenario-coverage audit --write
omc product-regression audit --write
```

2. Read `.omc/product/regression/current.json`.
3. Inspect `debts` by category:
   - `learning`: completed cycles without learning or learning recommendations not carried forward.
   - `capability-depth`: missing v1/v2/not-done-until depth.
   - `orphan`: capability graph isolation.
   - `scenario-proof`: user loop not proven by runtime QA/simulator/dogfood evidence.
   - `quality-regression`: historical scorecard regression.
   - `evidence`: missing feature expectation or weak proof.
4. Error debts block claims of completion. Warning debts must be fed into `/priority-engine` or explicitly invalidated.
5. Do not select unrelated new ideas above regression debts unless evidence shows the new idea is more important.

## Output

- `.omc/product/regression/current.json` — machine-readable cross-cycle regression and learning debt audit.
- `.omc/product/regression/current.md` — human-readable projection.

## Integration

- `/product-cycle` writes regression audit when a cycle advances from `learn` to `complete`.
- `/priority-engine` must read regression debts before selecting the next cycle.
- `omc feature-generation audit` counts regression as a source for future feature/opportunity generation.

## Failure Modes To Avoid

- Treating learning recommendations as optional notes.
- Starting a new product direction while previous completed work has unresolved error debts.
- Hiding scenario proof gaps under generic QA tasks.
- Letting a historical scorecard regression sit outside the roadmap.

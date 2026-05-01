---
name: scenario-coverage
description: Audit whether completed product capabilities are proven by executable user-loop scenarios through runtime QA, simulator, or dogfood evidence. Use after product-totality, during verify/learn, and before priority-engine when shipped work must be checked against real workflows.
argument-hint: "\"<product or cycle context>\" [--write]"
level: 4
---

# Scenario Coverage

Use this skill when completed capabilities need proof that they work as living user loops, not only as shipped controls or artifacts.

It connects:

```text
product totality + capability graph + runtime QA/dogfood evidence
```

## Usage

```bash
/scenario-coverage "prove knitting row reader scenarios"
omc scenario-coverage audit --write
omc scenario-coverage audit --json
```

## Inputs

Read compact/current artifacts first:

- `.omc/product/totality/current.json`
- `.omc/product/capability-graph/current.json`
- `.omc/product/scenario-coverage/current.json` when refreshing
- `.omc/runtime-qa.json`
- `.omc/handoffs/runtime-qa/current.json`
- `.omc/cycles/current.json`
- `.omc/learning/current.json`
- `.omc/portfolio/current.json`
- `.omc/roadmap/current.md`

## Protocol

1. Run:

```bash
omc product-totality audit --write
omc scenario-coverage audit --write
```

2. Read `.omc/product/scenario-coverage/current.json`.
3. For each scenario, inspect:
   - `expected_user_loop`
   - `coverage`: `missing | declared | runtime-passed | runtime-failed | dry-run | stale`
   - runtime QA status and evidence paths
   - gaps and recommended actions
4. If coverage is not `runtime-passed`, do not treat the capability as fully proven.
5. If a capability is both `orphan_capability` and lacks scenario proof, route reconnection/scenario work into `/priority-engine`.
6. If runtime QA is failing or blocked, fix that before learning/completion claims the scenario is covered.

## Output

- `.omc/product/scenario-coverage/current.json` — machine-readable capability-to-scenario audit.
- `.omc/product/scenario-coverage/current.md` — human-readable projection.

## Integration

- `/product-cycle` writes scenario coverage when a cycle advances from `learn` to `complete`.
- `/priority-engine` must read scenario coverage before selecting unrelated new ideas.
- `omc feature-generation audit` counts scenario coverage as a source for future feature/opportunity generation.

## Failure Modes To Avoid

- Calling a capability done because unit tests pass while no user loop is proven.
- Treating dry-run simulator output as complete scenario evidence.
- Letting `orphan_capabilities` proceed without a scenario that connects them to a real workflow.
- Creating scenario docs without executable runtime QA, simulator, or explicit dogfood evidence.

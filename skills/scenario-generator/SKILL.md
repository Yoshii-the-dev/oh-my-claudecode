---
name: scenario-generator
description: Generate return-session user-loop scenario declarations from feature expectation contracts. Use after cycle spec and before runtime QA/scenario coverage when a feature needs executable proof of meaningful use.
argument-hint: "\"<cycle or feature context>\" [--write]"
level: 4
---

# Scenario Generator

Use this skill after a cycle spec contains `feature_expectation_contract`. It converts the contract into a concrete proof loop that can later be implemented as runtime QA, simulator, or dogfood evidence.

## Usage

```bash
/scenario-generator "generate proof loop for knitting row reader"
omc scenario-generator generate --write --apply-runtime-qa
omc scenario-generator generate --write --run-runtime-qa
omc scenario-generator generate --json
```

## Inputs

Read compact/current artifacts first:

- `.omc/cycles/current.json`
- `.omc/cycles/current.md`
- `.omc/portfolio/current.json`
- `.omc/product/scenarios/current.json` when refreshing

## Protocol

1. Run:

```bash
omc scenario-generator generate --write --apply-runtime-qa
```

2. Read `.omc/product/scenarios/current.json`.
3. For each generated scenario, inspect:
   - `user_job`
   - `first_meaningful_use`
   - ordered steps
   - `runtime_qa_flow`
   - `dogfood_prompt`
   - `evidence_required`
4. Ensure the scenario includes:
   - setup/open product context
   - first meaningful use
   - core action
   - persisted or visible state change
   - exit/restart/leave step
   - return-session step
   - continue-with-context step
   - proof that `useless_if` is false
5. If the command reports `runtime_qa.status: needs-harness`, add a Playwright, Maestro, dogfood, simulator, or project-script smoke harness before calling the capability proven.
6. If a harness is available, run `omc scenario-generator generate --write --run-runtime-qa` or `omc runtime-qa run --auto --json`, then audit scenario coverage.

## Output

- `.omc/product/scenarios/current.json` — machine-readable generated scenario declarations.
- `.omc/product/scenarios/current.md` — human-readable scenario projection.
- `.omc/runtime-qa.json` — generated `runtime_qa_flow` declarations merged into the executable harness when supported.
- `.omc/handoffs/runtime-qa/current.json` — runtime proof written when `--run-runtime-qa` executes.

## Integration

- `/product-cycle` writes generated scenarios when advancing to build and again before completion audits.
- `omc scenario-coverage audit` treats generated scenarios as declared proof targets; they still require runtime QA, simulator, or dogfood evidence to become `runtime-passed`.
- `/priority-engine` must treat generated-but-unrun scenarios as scenario proof debt.

## Failure Modes To Avoid

- Treating generated scenario declarations as proof that the feature works.
- Generating scenarios from placeholder `feature_expectation_contract` values.
- Skipping the return-session step for user-facing product work.
- Writing generic QA instructions that do not include the feature's `useless_if` failure conditions.

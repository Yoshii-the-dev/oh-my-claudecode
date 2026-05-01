---
name: capability-lifecycle
description: Classify completed product capabilities as seeded, proving, connected, mature, deprecated, or remove-candidate. Use after product-totality/scenario-coverage/regression when deciding whether to deepen, prove, connect, retain, deprecate, or remove existing work.
argument-hint: "\"<product or capability context>\" [--write]"
level: 4
---

# Capability Lifecycle

Use this skill when the product already has completed cycles and you need a practical decision about what existing capabilities mean.

It turns aggregate audits into action:

```text
completed capability -> lifecycle stage -> engineering/product decision
```

## Usage

```bash
/capability-lifecycle "triage knitting app capabilities"
omc capability-lifecycle audit --write
omc capability-lifecycle audit --json
```

## Inputs

Read compact/current artifacts first:

- `.omc/product/totality/current.json`
- `.omc/product/capability-graph/current.json`
- `.omc/product/scenarios/current.json`
- `.omc/product/scenario-coverage/current.json`
- `.omc/product/regression/current.json`
- `.omc/portfolio/current.json`
- `.omc/roadmap/current.md`

## Protocol

1. Run:

```bash
omc product-totality audit --write
omc scenario-generator generate --write
omc scenario-coverage audit --write
omc product-regression audit --write
omc capability-lifecycle audit --write
```

2. Read `.omc/product/capability-lifecycle/current.json`.
3. For each capability, inspect:
   - `stage`: `seeded | proving | connected | mature | deprecated | remove-candidate`
   - `decision`: `develop-depth | prove | connect | retain | deprecate | remove-or-redesign`
   - scenario coverage
   - regression debt count
   - orphan status
   - recommended action
4. Feed non-mature capabilities into `/priority-engine` before unrelated new work.
5. Treat `remove-candidate` as a hard product-quality signal: do not add more UI/backend around it until it is removed, merged, or redesigned around a real user loop.

## Output

- `.omc/product/capability-lifecycle/current.json` — machine-readable lifecycle stage map.
- `.omc/product/capability-lifecycle/current.md` — human-readable lifecycle projection.

## Lifecycle Meaning

- `seeded`: v0 exists, but depth/proof/connection is incomplete.
- `proving`: scenario is declared or implied, but runtime QA/dogfood proof is missing.
- `connected`: capability has meaningful product/learning/roadmap connections but still needs depth.
- `mature`: systemic v2 capability with runtime proof and no blocking debt.
- `deprecated`: roadmap or portfolio explicitly says the capability is being sunset.
- `remove-candidate`: isolated, unproven, or debt-heavy work likely should be removed, merged, or redesigned.

## Practical Engineering Use

- Prevents “done” labels on v0 controls that still need v1/v2 depth.
- Gives cleanup/refactor work a product reason, not only a code-style reason.
- Lets priority-engine rank removal/redesign against new feature ideas.
- Helps product-cycle avoid building more systems around a meaningless seed.

## Failure Modes To Avoid

- Treating `seeded` as shippable maturity.
- Treating `remove-candidate` as optional polish.
- Deleting a capability solely because it is young; removal requires isolation, missing proof, debt, or explicit roadmap intent.
- Calling `mature` without runtime/dogfood proof.

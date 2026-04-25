---
name: priority-engine
description: Rank the living product opportunity portfolio and choose the next development cycle. Use after ideate/product-strategist/product-foundation, when a product has discovery artifacts but needs a small next step instead of a few oversized feature bets.
argument-hint: "\"<cycle goal>\" [--refresh-ecosystem] [--foundation-lite]"
level: 4
---

# Priority Engine

Use this skill to bridge discovery and execution. It creates a ranked opportunity map and rolling roadmap, then selects one core product slice, one enabling task, and one learning/research task for the next cycle.

The machine-readable source of truth is `.omc/portfolio/current.json`. Markdown artifacts are downstream human-readable projections.

## Usage

```bash
/priority-engine "choose next cycle for pre-MVP knitting companion"
/oh-my-claudecode:priority-engine "rank roadmap after foundation"
/priority-engine "refresh Q2 product opportunities" --refresh-ecosystem
```

## Inputs

Read compact/current artifacts first:

- `.omc/ideas/current.md`
- `.omc/competitors/landscape/current.md`
- `.omc/research/current.md`
- `.omc/product/capability-map/current.md`
- `.omc/classification/features-core-context.md`
- `.omc/meaning/current.md`
- `.omc/ecosystem/current.md`
- existing `.omc/portfolio/current.json` when refreshing a portfolio

Do not bulk-read archives. Use indexes and explicit pointers.

## Protocol

1. Determine product stage: `empty | pre-mvp | mvp | post-mvp`.
2. If `.omc/ecosystem/current.md` is absent, stale, or core features lack depth paths, invoke `product-ecosystem-architect` first. If the current cycle is urgent, continue but mark ecosystem confidence LOW.
3. Invoke `priority-engine` with the cycle goal and compact artifact digest.
4. Require the agent to rank 20-40 candidate moves across product, UX, research, backend, quality, brand/content, and distribution.
5. Require the selected cycle portfolio:
   - `1 core product slice`
   - `1 enabling task`
   - `1 learning/research task`
   - if any selected product/enabling task has LOW confidence or weak/proxy evidence, the learning task must be explicit research debt for that uncertainty.
6. Require `.omc/portfolio/current.json` with one item per candidate:
   - `id`
   - `title`
   - `lane`
   - `status`
   - `confidence`
   - `dependencies`
   - `selected_cycle`
   - `evidence`
7. Verify outputs:
   - `.omc/portfolio/current.json`
   - `.omc/opportunities/current.md`
   - `.omc/roadmap/current.md`
   - roadmap keeps weak-evidence items as `research debt`, `learning gate`, or `research gate`
8. Run the ledger and contract gates:
   - `omc portfolio validate`
   - `omc portfolio project --write`
   - `omc doctor product-contracts --stage priority-handoff`
   - Fix any errors before handing off to `product-pipeline`, `backend-pipeline`, or `technology-strategist`.

Legacy migration: if `.omc/opportunities/current.md` exists but `.omc/portfolio/current.json` is missing, run `omc portfolio migrate --write` before validation. Use `--force` only when intentionally replacing a stale ledger.

## Pre-MVP Rule

For empty or pre-MVP apps, the default next cycle is a first usable loop. Infrastructure is allowed only when it directly unlocks that loop.

Example shape:

```text
open/import sample -> perform the core job -> persist progress/state -> return next session
```

Do not route to technology ADR/provisioning just because the stack is incomplete. Use ADRs only when the next selected slice cannot be built responsibly without one.

## Research Debt Rule

If evidence is weak, do not just continue with LOW confidence. Convert the uncertainty into a candidate move:

- lane: `research`
- type: `learning`
- status: `selected` when it affects the selected cycle
- selected_cycle: same cycle id as the weak product/enabling item
- expected_learning: the decision this research will unlock

Then keep it visible in `.omc/roadmap/current.md` as research debt or a learning/research gate.

## Outputs

- `.omc/portfolio/current.json` — compact machine-readable work-item ledger.
- `.omc/portfolio/current.md` — human-readable projection generated from the ledger.
- `.omc/opportunities/current.md` — ranked candidate moves with evidence, confidence, expected learning, and dependency unlock.
- `.omc/roadmap/current.md` — rolling 2/6/12-week roadmap.

Both artifacts must include a compact footer:

```yaml
status: ok | needs-research | blocked | needs-human-decision
evidence:
  - <path or source>
confidence: <0.0-1.0>
blocking_issues:
  - <issue or []>
next_action: <agent/command and why>
artifacts_written:
  - <path>
```

## Contract Gate

Before declaring the priority pass complete, validate that the opportunity and roadmap artifacts are usable by downstream agents:

```bash
omc portfolio migrate --write  # only when migrating legacy markdown output
omc portfolio validate
omc doctor product-contracts --stage priority-handoff
```

For foundation work, the orchestrator should run `omc doctor product-contracts --stage foundation-lite` after ecosystem, opportunity, and roadmap artifacts exist.

## Failure Modes To Avoid

- Ranking only 3-7 large features.
- Letting backend/package work outrank a missing user-visible loop in an empty app.
- Treating competitor research as a long digest instead of action evidence.
- Producing brand philosophy without reusable meaning hooks and marketing/content angles.
- Producing a fixed long-range roadmap rather than a rolling roadmap with learning gates.

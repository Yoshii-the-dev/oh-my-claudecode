---
name: product-experience-gate
description: Pre-build UX/experience gate for user-facing product work. Use before product-pipeline or any user-visible build to prove user journey, empty states, failure states, return session, and perceived value are coherent.
argument-hint: "\"<cycle goal or core product slice>\""
level: 4
---

# Product Experience Gate

Use this skill after `/product-cycle` reaches `spec` and before any user-facing build. It prevents technically correct work from shipping without a usable product loop.

The gate writes `.omc/experience/current.md`. Build is blocked until `omc doctor product-contracts --stage cycle` passes.

## Inputs

Read compact/current artifacts:

- `.omc/cycles/current.md`
- `.omc/portfolio/current.json`
- `.omc/opportunities/current.md`
- `.omc/roadmap/current.md`
- `.omc/product/capability-map/current.md`
- `.omc/meaning/current.md`
- `.omc/ecosystem/current.md`

Do not inspect source code unless the cycle spec requires verifying an existing UI surface.

## Protocol

1. Identify the selected `core_product_slice`, `enabling_task`, and `learning_task`.
2. Map the smallest user journey that proves the core slice.
3. Define required empty states before first successful use.
4. Define required failure states and recovery behavior.
5. Define return-session behavior: what the user sees when they come back later.
6. State perceived value in user language: what feels better, faster, safer, clearer, or more rewarding.
7. Decide verdict:
   - `pass` only when the user can complete and understand the loop.
   - `blocked` when the selected work is mostly infrastructure or lacks a visible loop.
   - `needs-research` when evidence is too weak and the learning task is not sufficient.
8. Write `.omc/experience/current.md`.
9. Run:

```bash
omc doctor product-contracts --stage cycle
```

## Output Contract

`.omc/experience/current.md` must include:

- `User Journey`
- `Empty States`
- `Failure States`
- `Return Session`
- `Perceived Value`
- `UX Verdict`

Template:

```markdown
# Experience Gate: <cycle goal>

## User Journey
<step-by-step journey from entry to successful loop completion>

## Empty States
<what appears before user content/data exists>

## Failure States
<recoverable errors, blocked states, retry/escape path>

## Return Session
<what happens when the user comes back later>

## Perceived Value
<why the user feels the product helped>

## UX Verdict
pass | blocked | needs-research

status: ok | needs-research | blocked | needs-human-decision
evidence:
  - <artifact path or source>
confidence: <0.0-1.0>
blocking_issues:
  - <issue or []>
next_action: <agent/command and why>
artifacts_written:
  - ".omc/experience/current.md"
```

## Research Debt Rule

If the journey depends on weak evidence, do not simply pass with LOW confidence. Ensure `.omc/portfolio/current.json` contains a selected `learning` or `research` task for the same `selected_cycle`, and ensure `.omc/roadmap/current.md` keeps the research debt in a learning/research gate.

## Failure Modes To Avoid

- Passing because the schema or backend contract is correct while the user loop is absent.
- Omitting empty states for an app with no user data.
- Omitting return-session behavior for workflows with progress, drafts, history, or sessions.
- Treating research debt as a note instead of a selected learning task.

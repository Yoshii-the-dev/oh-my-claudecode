---
name: creative-loop
description: Divergent UI/UX creative loop for user-facing visual work. Use before product-pipeline when a feature needs original visual language, brand fit, motion, design tokens, component experiments, screenshots, or visual verdict evidence.
argument-hint: "\"<visual/product goal>\" [--phase brief|directions|experiments|taste-gate]"
level: 4
---

# Creative Loop

Use this before implementation for UI/UX work where "make it look good" is not enough. The loop turns product meaning, market tension, user state, and visual constraints into testable design directions before anything is promoted into a design system.

## Usage

```bash
/creative-loop "create a distinct onboarding surface for row tracking"
omc creative-loop init --goal "row tracking onboarding"
omc creative-loop audit --write --goal "row tracking onboarding"
omc creative-loop lifecycle --write --goal "row tracking onboarding"
```

## Pipeline

Run the phases in order and write the artifacts listed here:

| Phase | Output |
|---|---|
| Meaning brief | `.omc/design/meaning-brief/current.md` |
| Inspiration ledger | `.omc/design/inspiration-ledger/current.md` |
| Visual expectation contract | `.omc/design/visual-expectation/current.json` |
| Design directions | `.omc/design/directions/current.md` |
| Motion grammar | `.omc/design/motion-grammar/current.md` |
| Token system | `.omc/design/tokens/current.json` |
| Component experiments | `.omc/design/component-experiments/current.json` |
| Taste gate | `.omc/design/taste-gate/current.md` |
| Visual lifecycle | `.omc/design/visual-lifecycle/current.json` |
| Design system promotion | `.omc/design/system/current.md` only after taste gate passes |

## Protocol

1. Start with the meaning brief:
   - what the product should make the user feel;
   - what it should make the user understand;
   - the user's before/during/after state;
   - the product meaning that should shape the interface.
2. Build an inspiration ledger from references as principles, not as copy targets.
   - Capture the source, extracted principle, applicable constraint, and what not to copy.
3. Write the visual expectation contract.
   - Required fields: `desired_perception`, `category_codes_to_avoid`, `inspiration_principles`, `selected_direction`, `token_rationale`, `component_proofs`, `screenshot_evidence`, and `not_ready_if`.
   - Component proofs must reference screenshot files that exist and a passing visual verdict.
   - `not_ready_if` must name concrete conditions where the implementation would be technically present but visually meaningless or generic.
4. Produce 3-5 distinct design directions.
   - Each direction must be a visual hypothesis with tradeoffs, not a style adjective.
   - Keep at least one direction meaningfully unusual for the category.
5. Define motion grammar.
   - List which states animate, why the animation helps, duration, easing, and reduced-motion fallback.
6. Define a token system.
   - Cover color, type, spacing, radius, elevation, and motion.
   - Tokens are hypotheses until experiments pass.
7. Build small component experiments.
   - Produce screenshots or screenshot paths.
   - Run `visual-verdict` or equivalent visual review and record the verdict in `.omc/design/component-experiments/current.json`.
8. Run the taste gate.
   - Score distinctiveness, usability, accessibility, and brand fit.
   - `verdict: pass` is allowed only when evidence exists from experiments/screenshots/verdicts.
9. Write the visual lifecycle:
   - Run `omc creative-loop lifecycle --write --goal "<visual/product goal>"`.
   - Treat phases as cumulative evidence: `visual-hypothesis`, `implementation-mapping`, `screenshot-proof`, and `iteration-debt`.
   - Carry every `not_ready_if` condition forward as iteration debt instead of letting a single passing screenshot end the design work.
10. Promote into `.omc/design/system/current.md` only after the taste gate passes and visual lifecycle is `healthy` or has explicit watchlist-only debt.

## Visual Expectation Contract

`.omc/design/visual-expectation/current.json` must use this shape:

```json
{
  "schema_version": 1,
  "visual_expectation_contract": {
    "desired_perception": ["what the user should perceive or feel"],
    "category_codes_to_avoid": ["generic SaaS dashboard", "spreadsheet tracker"],
    "inspiration_principles": [
      {
        "source": "specific reference",
        "principle": "extractable principle",
        "what_not_to_copy": "signature details to avoid"
      }
    ],
    "selected_direction": {
      "name": "chosen visual hypothesis",
      "rationale": "why this direction fits the product meaning",
      "tradeoffs": "what it gains and loses"
    },
    "token_rationale": [
      { "token": "color.primary", "decision": "chosen value/use", "reason": "meaning and usability reason" }
    ],
    "component_proofs": [
      {
        "component": "component or screen",
        "state": "tested state",
        "screenshot": ".omc/artifacts/creative-loop/example.png",
        "visual_verdict": "pass"
      }
    ],
    "screenshot_evidence": [".omc/artifacts/creative-loop/example.png"],
    "not_ready_if": ["condition that proves the visual work is still generic or meaningless"]
  }
}
```

## CLI Contract

Use the CLI to keep the gate machine-checkable:

```bash
omc creative-loop audit --write --goal "<visual/product goal>"
omc creative-loop lifecycle --write --goal "<visual/product goal>"
```

If artifacts are missing, initialize drafts:

```bash
omc creative-loop init --goal "<visual/product goal>"
```

Drafts do not pass the gate. Replace placeholders with real design reasoning, experiments, screenshots, and verdict evidence before implementation.

## Rules

- Creative output is generated from the tension between product meaning, users, market/category codes, constraints, and unusual visual language.
- Do not copy references. Convert references into principles and anti-copy notes.
- Do not collapse divergent work into one direction too early.
- Do not accept noun-only or style-only visual directions. The selected direction must say what perception it creates, what category code it avoids, and which component proof shows it.
- Do not let implementation start for a visual user-facing surface while the creative-loop audit reports `needs-brief`, `needs-divergence`, `needs-experiments`, or `needs-taste-gate`.
- Do not treat visual work as complete until `.omc/design/visual-lifecycle/current.json` maps hypothesis to implementation, screenshot proof, and iteration debt.
- Do not promote tokens or components into the design system until the taste gate passes.

## Handoff

Before handing off to `/product-pipeline`, include only:

- selected direction and why;
- visual expectation contract summary;
- token changes;
- component experiments and screenshot paths;
- visual verdict/taste-gate evidence;
- visual lifecycle status and iteration debt;
- blockers or accessibility risks;
- next action.

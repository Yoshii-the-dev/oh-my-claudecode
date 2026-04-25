# Run Scorecard

`omc run-scorecard` reports product/agent pipeline quality from `.omc/**` artifacts. It is intentionally artifact-based so it can evaluate real project runs, not only ideal prompt behavior. When `.omc/portfolio/current.json` exists, it is treated as a decision artifact because it carries work-item evidence, confidence, selected cycle, and lane data.

## Command

```bash
omc run-scorecard
omc run-scorecard /path/to/app
omc run-scorecard --json
```

## Metrics

| Metric | Meaning |
|---|---|
| `downstreamAcceptedWithoutReworkRate` | Share of handoffs accepted downstream without rework/revise/reject signals. |
| `reworkRate` | Share of handoffs that show rework, revise, reject, blocked, failed, or rewind signals. |
| `artifactBloatRate` | Share of `.omc` artifacts over the current compactness budget. |
| `timeToFirstUsableLoopDays` | Days between first dated artifact and first dated first-usable-loop/shipped-loop signal. |
| `userVisibleToInfrastructureRatio` | User-visible/product/UX/content/distribution work signals divided by infrastructure/backend/stack signals. |
| `evidenceConfidenceCoverage` | Share of decision-like artifacts that contain both `evidence:` and `confidence:`. |
| `researchInsteadOfInventionRate` | Research-routed uncertainty signals compared with invention-risk signals such as assumptions without evidence. |

## Interpretation

The scorecard is a diagnostic, not a grade. Use it to find where the framework is drifting:

- low accepted-handoff rate means upstream artifacts are not useful enough for downstream agents.
- high rework rate means stage contracts are vague or quality gates are late.
- high artifact bloat means agents are generating context debt.
- slow time-to-first-usable-loop means discovery/stack work is delaying product learning.
- low user-visible/infrastructure ratio means the framework is over-investing in internal systems.
- low evidence/confidence coverage means decisions are not auditable.
- low research/invention rate means agents are guessing instead of routing uncertainty to research.

The first implementation uses conservative heuristics over existing `.omc` markdown/json artifacts. Newer artifacts should keep explicit `status:`, `evidence:`, `confidence:`, `next_action:`, and handoff verdict fields to improve scorecard accuracy. Portfolio items should keep `id`, `lane`, `status`, `confidence`, `dependencies`, `selected_cycle`, and `evidence` populated so the scorecard can distinguish user-visible work from infrastructure drift.

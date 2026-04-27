---
name: handoff-orchestrator
description: JSON-first pipeline orchestrator — reads .output.json sidecar files produced by OMC agents, validates against agent-output.schema.json, routes by routing.next_recommended, loops. Interactive by default; --auto for unsupervised chains
argument-hint: "[<starting-artifact-path> | --auto | --max-steps=N]"
level: 4
---

# Handoff Orchestrator Skill

JSON-first orchestrator that follows structured output chains produced by OMC agents. Reads `.output.json` sidecar files, validates them against `docs/schemas/agent-output.schema.json`, routes by `routing.next_recommended[0]`, loops. Stops at end-of-chain, user input required, halt block, or max-steps.

Enables token-efficient pipelines: each agent writes JSON data + Markdown projection; orchestrator routes based on JSON only; downstream agents read only the JSON signals, not full prose.

## Usage

```
/oh-my-claudecode:handoff-orchestrator <artifact-path>        # follow from specific artifact
/oh-my-claudecode:handoff-orchestrator                        # auto-detect most recent artifact
/handoff-orchestrator <path> --auto                           # unsupervised; no per-step confirm
/handoff-orchestrator <path> --max-steps=5                    # safety cap on chain length
```

### Examples

```
/handoff-orchestrator .omc/product/capability-map/current.output.json     # follow from strategist output
/handoff-orchestrator --auto                                               # follow most recent output unsupervised
/handoff-orchestrator .omc/decisions/2026-04-20-technology-matching.output.json --max-steps=3
```

### Flags

- `--auto` — skip per-step user confirmation; invoke each `routing.next_recommended[0]` automatically until halt or end-of-chain.
- `--max-steps=<int>` — safety cap (default 10). Protects against accidental loops.
- `--stop-at=<agent-name>` — halt chain when this agent becomes next_recommended (useful for pausing before human-heavy gates).
- `--include-optional` — follow not just `required: true` but also `required: false` handoffs (expands chain).
- `--dry-run` — show the chain that would execute; don't invoke.

<Purpose>
Automates agent-to-agent handoffs without requiring users to manually invoke each step. Reads `.output.json` files per the `docs/schemas/agent-output.schema.json` standard, validates them, extracts `routing.next_recommended`, invokes, continues. For strategy agents, reads the `strategy.decision.verdict` and routes accordingly. Preserves user control via interactive default (confirm between steps), with `--auto` for trusted chains.
</Purpose>

<Use_When>
- Agent produced a `.output.json` sidecar with `routing.next_recommended` items and you want to follow the chain without manual invocation per step.
- Technology Strategist, critic, or stack-provision produced a structured output with `strategy.decision` and you need deterministic routing through Strict Gate.
- Running a workflow like product-strategist → priority-engine → product-cycle-controller where each step consumes the previous.
- Resuming a halted pipeline after remediation (output's `halt.resume_from` guides re-entry).
- Running scheduled agent chains unsupervised.
</Use_When>

<Do_Not_Use_When>
- No `.output.json` sidecar exists for the source artifact (agent is pre-v2 or doesn't follow the standard).
- You need fine-grained control over each step — manual invocation is clearer for exploratory work.
- Chain enters agents that fundamentally require human presence (design-partner sessions, interactive interviews).
</Do_Not_Use_When>

<Protocol>

## Phase 0 — Locate Starting Output

If positional arg provided:
1. If it ends with `.output.json`, use directly.
2. If it ends with `.md` or `.json`, derive the sidecar path: replace `.md`/`.json` with `.output.json`.

Otherwise:
1. Glob `.omc/**/*.output.json` for files modified in the last 2 hours.
2. Pick the most recently modified.
3. If ambiguous (multiple recent outputs), list top 3 and ask user.

HARD STOP if no `.output.json` sidecar is found.

## Phase 1 — Validate Output

Read the JSON file. Parse and validate against `docs/schemas/agent-output.schema.json` using the `validateAgentOutput()` function from `src/product/agent-output.ts`.

Validation failures are HARD STOPs: surface the specific issues (field name, expected type, actual value). Do NOT attempt to infer missing routing from Markdown prose.

## Phase 2 — Decision

Examine the validated output:

| Condition | Route |
|---|---|
| `status == "complete"` AND `routing.next_recommended == []` | Chain end. Report terminal summary and exit. |
| `status == "halted"` | Surface `halt.reason` + `halt.remediation`. Do NOT auto-invoke anything. |
| `requires_user_input` has `blocking: true` items | Surface questions; stop. |
| `status == "blocked"` | Surface `blocking_issues`. Do NOT auto-invoke anything. |
| `routing.next_recommended[0].required == true` | Candidate for invocation. |
| `routing.next_recommended[0].required == false` | Invoke only if `--include-optional` flag present. |

Apply `--stop-at` if set: if `routing.next_recommended[0].agent == <stop-at>`, report "stopping before <agent>"; exit without invoking.

For strategy outputs (when `strategy` field is present), apply additional routing:

| Condition | Route |
|---|---|
| `strategy.compatibility_report.overall_status == "blocked"` | Halt; provisioning is forbidden |
| `strategy.decision.verdict == "rewind"` and rewind limit not exceeded | Invoke `technology-strategist` with capability-map rewind directive |
| `strategy.decision.verdict == "rewind"` and rewind limit exceeded | Invoke `/deep-interview` then stop for human decision |
| `strategy.decision.verdict == "revise"` | Invoke `technology-strategist` with critic findings |
| `strategy.decision.verdict == "approve"` and next is `stack-provision` | Invoke stack-provision only after critic verdict is approve |

## Phase 3 — User Confirmation (unless --auto)

Show the user:
```
Next step: <agent-name>
Purpose: <routing entry purpose>
Primary artifact: <primary_artifact.path>
Confidence: <confidence>
Required: <bool>
```

Ask: "proceed / skip / stop"?
- `proceed` (default): invoke the agent with the output JSON as context.
- `skip`: advance to `routing.next_recommended[1]` if present; else exit.
- `stop`: exit chain with current state.

With `--auto`, skip confirmation; invoke directly.

## Phase 4 — Invoke

Invoke the target agent OR skill via Task-tool with directive:

```
Handoff-orchestrator invocation.
Upstream structured output: <path to .output.json>
Upstream signals:
  <key signals from output.signals>
Gate readiness:
  <gate_readiness from output.routing>

Your task: <routing entry purpose>

Write your results as JSON structured output per docs/schemas/agent-output.schema.json.
Your .output.json sidecar will be read by the orchestrator for the next routing step.
```

Wait for completion. Detect new `.output.json` written.

For strategy outputs, additionally include:
```text
Schema-first structured output.
Validate against docs/schemas/agent-output.schema.json before writing.
Respect strategy.permissions.read_scope and strategy.permissions.write_scope.
Do not write source code unless your role explicitly allows it.
Include strategy block with scorecard, compatibility, risk, decision, and permissions.
```

## Phase 5 — Loop

If the just-completed agent produced a new `.output.json`, return to Phase 1 using that as starting point.

If it produced no `.output.json` (non-compliant agent) → report "chain terminated — <agent> did not emit structured output" and exit gracefully.

Track step count; if `--max-steps` reached, halt and report.

## Phase 6 — Terminal Summary

At end of chain, emit:
```
Chain complete.
Steps executed: N
Final status: <last output's status>
Confidence: <last output's confidence>
Artifacts produced in chain: [<list>]
Final next_recommended: <if any>
```

</Protocol>

<Input_Contract>
Positional arg (optional): path to starting artifact (`.output.json` sidecar, `.md`, or `.json` — the sidecar is derived automatically).

Flags:
- `--auto` — unsupervised mode (still stops at halts, blocking user input).
- `--max-steps=<int>` — chain length cap (default 10).
- `--stop-at=<agent>` — halt before invoking the named agent.
- `--include-optional` — follow `required: false` handoffs too.
- `--dry-run` — show planned chain without invoking.
</Input_Contract>

<Output>
- Terminal summary of the chain execution.
- No new artifacts written by orchestrator itself — downstream agents write their own.
- Audit log at `.omc/handoffs/orchestrator/YYYY-MM-DD-HHMM.md` with invocation timeline.
</Output>

<Failure_Modes_To_Avoid>
- **Invoking agents that don't produce `.output.json`.** If downstream agent produces no structured output, chain terminates gracefully — do NOT attempt to infer next step from prose.
- **Ignoring `halt` blocks.** A halt means remediation required; do NOT try to proceed.
- **Looping on same artifact.** Track invoked agents + output paths; detect cycles (same agent + same path twice → abort with cycle warning).
- **Running with no `--max-steps` cap.** Default 10 is enforced; `--max-steps=0` is explicitly rejected.
- **Treating optional handoffs as required.** `required: false` entries are NEVER auto-invoked without explicit `--include-optional` flag.
- **Parsing Markdown for routing.** The whole point of structured outputs is JSON-first routing. Only read `.output.json` for machine decisions.
- **Silent handling of invalid JSON.** If the `.output.json` exists but fails validation, surface the specific validation errors — don't guess.
- **Skipping `requires_user_input` blocking items.** These exist because an agent genuinely needs a user decision; auto-routing past them corrupts downstream work.
- **Calling stack-provision before critic approval.** Strict Gate requires `strategy.decision.verdict == "approve"` from critic; a strategist recommendation alone is not sufficient.
</Failure_Modes_To_Avoid>

<Integration_Notes>
- Consumes structured outputs per `docs/schemas/agent-output.schema.json` (schema_version: 2).
- Validates using `validateAgentOutput()` from `src/product/agent-output.ts`.
- Writes audit log to `.omc/handoffs/orchestrator/` for replayability.
- Composable with `/oh-my-claudecode:loop` for periodic chain continuation (e.g., after a design-partner session completes, resume).
- Pre-v2 agents don't emit `.output.json`; when chain reaches them, it terminates gracefully with "chain terminated" rather than errors.
- Can be combined with `/oh-my-claudecode:ralph` for retry-on-transient-failure at any single step.
</Integration_Notes>

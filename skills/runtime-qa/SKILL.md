---
name: runtime-qa
description: Run and repair project runtime QA, simulator checks, and disposable fixtures from inside Claude Code
argument-hint: "[project-root]"
level: 3
---

# Runtime QA

Use this skill when a project has `.omc/runtime-qa.json`, when `omc doctor runtime-qa`
reports fixture or simulator readiness issues, or when the user asks to run
Maestro/Detox/Appium/Playwright runtime checks through OMC.

## Goal

Turn runtime QA from a shell-only command into a Claude Code guided workflow:
diagnose readiness, prepare disposable fixtures, run the configured checks, and
record evidence in `.omc/handoffs/runtime-qa/current.json`.

## Workflow

1. Resolve the project root from the argument, or use the current working
   directory.
2. Run:
   ```bash
   omc runtime-qa setup <project-root> --json
   ```
3. If setup reports command steps and the user has allowed local bootstrap work,
   run:
   ```bash
   omc runtime-qa setup <project-root> --apply --json
   ```
   Manual setup steps must be reported clearly; do not pretend they were fixed
   by the agent.
4. Run:
   ```bash
   omc doctor runtime-qa <project-root> --json
   ```
5. If the doctor reports `runtime-qa-fixture-agent-mcp-required`, handle the
   fixture before running the destructive simulator flow:
   ```bash
   omc runtime-qa fixture provision <fixture-name> <project-root> --backend mcp --json
   ```
6. Read the returned `agent_action`.
7. Use Supabase MCP only through explicit Supabase/Auth/Admin user-management
   tools if they are available in the current Claude session.
8. If the Supabase MCP server only exposes database SQL tools such as
   `execute_sql`, do not create or delete users by directly editing `auth.users`.
   Report that this session needs either an Auth/Admin MCP capability or the
   trusted env backend:
   ```bash
   omc runtime-qa fixture provision <fixture-name> <project-root> --backend env --json
   ```
9. After a fixture is provisioned and its env file exists, run:
   ```bash
   omc runtime-qa run <project-root> --json
   ```
10. Always attempt teardown for destructive fixtures after the simulator command:
   ```bash
   omc runtime-qa fixture teardown <fixture-name> <project-root> --backend mcp --json
   ```
11. Re-run the doctor and report only evidence-backed status:
   ```bash
   omc doctor runtime-qa <project-root> --json
   ```

## Supabase MCP Fixture Contract

For `provider: "supabase"` and `strategy: "auth-admin-user"`:

- Create users only in development or testing Supabase projects.
- Prefer project-scoped Supabase MCP configuration.
- Use a generated disposable email and strong password.
- Mark the user with metadata such as `runtime_qa: true`, fixture name, and run
  id when the Auth/Admin tool supports metadata.
- Write the state file returned by `agent_action.statePath` with:
  `provider`, `strategy`, `backend`, `user_id`, `email`, `password`, and
  `created_at`.
- Write the env file returned by `agent_action.envPath` with the variable names
  listed in `agent_action.required_env`.
- Keep teardown idempotent: missing state or already-deleted users are not
  failures.

## Safety Rules

- Do not connect runtime QA fixture provisioning to production Supabase data.
- Do not expose service-role keys in app code, Maestro flows, screenshots, or
  final reports.
- Do not insert, update, or delete rows directly in `auth.users` through SQL as
  a shortcut. Supabase Auth users must be managed through Auth/Admin APIs or
  explicit Auth/Admin MCP tools.
- If the MCP tool surface is read-only or lacks Auth/Admin user tools, stop the
  MCP provisioning step and use the env backend in a trusted local/CI shell.

## Output

Report:

- Setup plan/applied steps and any manual prerequisites that remain.
- Doctor issues before the run.
- Fixture provisioning path used: `env`, `mcp Auth/Admin`, or blocked with the
  missing capability.
- Runtime QA command status.
- Handoff path written.
- Remaining risks.

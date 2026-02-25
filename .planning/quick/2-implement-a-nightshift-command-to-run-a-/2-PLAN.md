---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/run.ts
  - src/cli/index.ts
  - tests/integration/run.test.ts
autonomous: true
requirements: ["QUICK-2"]

must_haves:
  truths:
    - "User can run a generic one-off task immediately via `nightshift run <prompt>`"
    - "User can run the code-agent immediately via `nightshift run --code-agent`"
    - "Output streams to stdout in real-time, and final summary is printed at exit"
    - "Command exits with 0 on success, non-zero on failure"
  artifacts:
    - path: "src/cli/commands/run.ts"
      provides: "CLI run command with --code-agent flag"
      min_lines: 80
    - path: "src/cli/index.ts"
      provides: "Updated CLI entrypoint registering run command"
    - path: "tests/integration/run.test.ts"
      provides: "Integration tests for run command"
      min_lines: 40
  key_links:
    - from: "src/cli/commands/run.ts"
      to: "src/daemon/agent-runner.ts"
      via: "AgentRunner.run() for generic tasks"
      pattern: "new AgentRunner"
    - from: "src/cli/commands/run.ts"
      to: "src/agent/code-agent.ts"
      via: "runCodeAgent() for code-agent mode"
      pattern: "runCodeAgent"
---

<objective>
Add a `nightshift run` command that executes a task or code-agent immediately as a one-off foreground process, bypassing the daemon queue entirely.

Purpose: Currently all task execution requires the daemon to be running. Users need a way to trigger a single task or code-agent run immediately for testing, debugging, or ad-hoc use without starting the daemon.

Output: New `run` CLI command with integration tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@src/cli/index.ts
@src/cli/commands/submit.ts
@src/daemon/agent-runner.ts
@src/agent/code-agent.ts
@src/core/types.ts
@src/core/config.ts
@src/core/paths.ts
@src/cli/formatters.ts
@src/utils/process.ts
@tests/integration/submit.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create the `nightshift run` command</name>
  <files>src/cli/commands/run.ts, src/cli/index.ts</files>
  <action>
Create `src/cli/commands/run.ts` implementing two execution modes:

**Generic task mode** (`nightshift run <prompt>`):
- Accept a `<prompt>` argument (required unless `--code-agent` is used)
- Support the same flags as `submit`: `--timeout`, `--budget`, `--model`, `--tools`, `--name`
- Construct a `NightShiftTask` object (same as submit does, with `origin: "one-off"`)
- Instantiate `AgentRunner` directly (not via the daemon/pool) with `workspaceDir` from config and a CLI logger (`Logger.createCliLogger(true)` for verbose output)
- Call `runner.run(task)` and await the result
- Print a summary on completion: task name, duration (use `formatDuration` from formatters), cost (use `formatCost`), and result excerpt (first 200 chars)
- Exit with code 0 on success, 1 on error (check `result.isError`)

**Code-agent mode** (`nightshift run --code-agent`):
- Add a `--code-agent` boolean flag (short: `-c`)
- When set, `<prompt>` is NOT required (error if both `--code-agent` and a prompt are provided)
- Load config, verify `config.codeAgent` is defined (exit with error if not: "Code agent not configured in nightshift.yaml")
- Resolve `configDir` as `path.dirname(getConfigPath())`
- Call `runCodeAgent(config.codeAgent, configDir, { gitlabToken: process.env.GITLAB_TOKEN, timeoutMs, logger })` directly
- `timeoutMs`: use `--timeout` flag if provided, otherwise `config.defaultTimeout`, parsed via `parseTimeout`
- Print summary: outcome, category, MR URL (if any), duration, cost
- Use the same `deriveSummary` function from `src/agent/code-agent.ts` (it's already exported)

**Notifications:**
- Add a `--notify` boolean flag (short: `-N`)
- When set and `config.ntfy` is defined, instantiate `NtfyClient` and send start/end notifications mirroring the orchestrator's `notifyTaskStart`/`notifyTaskEnd` pattern

**Error handling:**
- Wrap the entire action in try/catch
- On error, print `error(...)` message and set `process.exitCode = 1`
- For code-agent, handle the `GITLAB_TOKEN` not being set: warn (not error) since the clone uses SSH and only MR creation needs the token

**Register the command** in `src/cli/index.ts`:
- Import `runCommand` from `./commands/run.js`
- Add `program.addCommand(runCommand)` following the existing pattern
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsc --noEmit</automated>
    <manual>Review that run.ts follows the same patterns as submit.ts (Commander, formatters, config loading)</manual>
  </verify>
  <done>
    - `nightshift run --help` shows usage for both generic and code-agent modes
    - TypeScript compiles without errors
    - Command is registered in the CLI index
  </done>
</task>

<task type="auto">
  <name>Task 2: Add integration tests for `nightshift run`</name>
  <files>tests/integration/run.test.ts</files>
  <action>
Create `tests/integration/run.test.ts` following the same pattern as `tests/integration/submit.test.ts`:

- Use a tmpDir with `fs.mkdtemp`, run `nightshift init`, overwrite config with `beads: enabled: false`
- Use the same `run()` helper that spawns `npx tsx bin/nightshift.ts` with a timeout

**Test cases for generic mode:**
1. `nightshift run --help` exits 0 and shows usage text including `--code-agent` and `<prompt>`
2. `nightshift run "echo hello"` — since `claude` won't be available in CI, the test should verify the command starts and fails gracefully (exits non-zero with a meaningful error about claude not being found, NOT a crash). This validates the wiring without needing the actual agent binary.
3. `nightshift run --code-agent` without `code_agent` config — should exit non-zero and stderr/stdout should contain "not configured"
4. Verify that `--code-agent` and a prompt together produce an error message

**Test cases for flag parsing (these don't need claude):**
5. `nightshift run --help` output contains `--timeout`, `--budget`, `--model`, `--tools`, `--code-agent`, `--notify` flags

**Pattern notes:**
- Follow the same `describe`/`it`/`beforeEach`/`afterEach` structure as submit.test.ts
- Use `spawnWithTimeout` from `../../src/utils/process.js`
- 15s timeout per spawn is sufficient
- These tests validate CLI wiring and error paths, not actual agent execution
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/integration/run.test.ts</automated>
  </verify>
  <done>
    - All integration tests pass
    - Tests verify both generic and code-agent error paths
    - Tests verify CLI flag registration
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes (no type errors)
2. `npx vitest run tests/integration/run.test.ts` passes (integration tests)
3. `npx vitest run` passes (no regressions in existing tests)
4. `npx tsx bin/nightshift.ts run --help` shows the expected usage
</verification>

<success_criteria>
- `nightshift run <prompt>` executes a task immediately using AgentRunner (foreground, no daemon)
- `nightshift run --code-agent` executes the code-agent pipeline immediately using runCodeAgent
- Both modes print a structured summary on completion (duration, cost, result)
- --notify flag enables ntfy notifications for the run
- All existing tests still pass
- New integration tests cover error paths and flag parsing
</success_criteria>

<output>
After completion, create `.planning/quick/2-implement-a-nightshift-command-to-run-a-/2-SUMMARY.md`
</output>

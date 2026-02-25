---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/types.ts
  - src/daemon/agent-pool.ts
  - src/daemon/orchestrator.ts
  - tests/unit/agent-pool.test.ts
  - tests/unit/orchestrator.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "When a recurring task has recurringName 'code-agent', the daemon routes it through runCodeAgent instead of the generic AgentRunner"
    - "The CodeAgentRunResult is adapted to AgentExecutionResult so orchestrator handleCompleted, inbox reports, and ntfy notifications all work unchanged"
    - "Generic tasks (non code-agent) continue to route through AgentRunner exactly as before"
    - "GITLAB_TOKEN from process.env is forwarded to runCodeAgent but never to generic AgentRunner tasks"
  artifacts:
    - path: "src/daemon/agent-pool.ts"
      provides: "Code-agent dispatch path branching"
    - path: "src/core/types.ts"
      provides: "NightShiftTask.isCodeAgent flag or equivalent identifier"
    - path: "tests/unit/agent-pool.test.ts"
      provides: "Tests proving code-agent routing vs generic routing"
  key_links:
    - from: "src/daemon/agent-pool.ts"
      to: "src/agent/code-agent.ts"
      via: "import runCodeAgent, conditional dispatch"
      pattern: "runCodeAgent"
    - from: "src/daemon/orchestrator.ts"
      to: "src/daemon/agent-pool.ts"
      via: "passes config through pool for code-agent dispatch"
      pattern: "codeAgent"
---

<objective>
Wire `runCodeAgent` (the 4-bead code improvement pipeline) into the daemon's task dispatch path so that code-agent recurring tasks execute the full pipeline (clone, analyze, implement, verify, MR, log) instead of a generic `claude -p` invocation.

Purpose: Currently `runCodeAgent` exists as a standalone function with full tests but is never called from the daemon. The daemon dispatches all tasks through `AgentRunner` (single `claude -p`). This plan connects the two so the nightly code improvement actually runs.

Output: Modified daemon dispatch that routes code-agent tasks through `runCodeAgent` and adapts results back to `AgentExecutionResult`.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/code-agent.ts (runCodeAgent function — entry point for 4-bead pipeline)
@src/agent/types.ts (CodeAgentRunResult, CodeAgentOutcome)
@src/core/types.ts (NightShiftTask, AgentExecutionResult, NightShiftConfig, CodeAgentConfig)
@src/daemon/agent-pool.ts (AgentPool — dispatches tasks, currently always uses AgentRunner)
@src/daemon/agent-runner.ts (AgentRunner — generic claude -p runner)
@src/daemon/orchestrator.ts (Orchestrator — owns config, pool, tick loop)
@src/daemon/scheduler.ts (Scheduler.createTask — creates NightShiftTask from RecurringTaskConfig)
@tests/unit/agent-pool.test.ts (existing pool tests)
@tests/unit/orchestrator.test.ts (existing orchestrator tests)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add isCodeAgent flag to NightShiftTask and set it in Scheduler</name>
  <files>src/core/types.ts, src/daemon/scheduler.ts</files>
  <action>
1. In `src/core/types.ts`, add an optional boolean field `isCodeAgent?: boolean` to the `NightShiftTask` interface. Place it after the `category` field.

2. In `src/daemon/scheduler.ts`, in the `createTask` method (line ~104), set `isCodeAgent: true` on the task object when `this.config.codeAgent` is defined AND the recurring task's `name` equals `"code-agent"`. This is the convention: only the recurring task named `"code-agent"` triggers the pipeline. The condition is:
   ```ts
   isCodeAgent: recurring.name === "code-agent" && !!this.config.codeAgent,
   ```
   Place this right after the `category` assignment (line ~120).

Do NOT change how category is resolved — that stays as-is.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/scheduler.test.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>NightShiftTask has isCodeAgent field. Scheduler sets it to true only for recurring tasks named "code-agent" when codeAgent config exists.</done>
</task>

<task type="auto">
  <name>Task 2: Route code-agent tasks through runCodeAgent in AgentPool</name>
  <files>src/daemon/agent-pool.ts, src/daemon/orchestrator.ts, tests/unit/agent-pool.test.ts</files>
  <action>
**AgentPool changes (`src/daemon/agent-pool.ts`):**

1. Import `runCodeAgent` from `"../agent/code-agent.js"` and import `type CodeAgentConfig` from `"../core/types.js"`.

2. Add `codeAgentConfig?: CodeAgentConfig` and `configDir: string` to the constructor options interface (alongside existing `maxConcurrent`, `workspaceDir`, `logger`). Store both as private readonly fields. `configDir` is the directory containing nightshift.yaml — needed by `runCodeAgent` for prompt template resolution. Default `configDir` to `process.cwd()`.

3. In the `dispatch` method, after the `canAccept()` guard, add a branch: if `task.isCodeAgent && this.codeAgentConfig`, run the code-agent path instead of creating an `AgentRunner`:

```ts
if (task.isCodeAgent && this.codeAgentConfig) {
  const startedAt = new Date();
  const promise = this.runCodeAgentTask(task, startedAt);
  this.running.set(task.id, { task, runner: null as any, startedAt, promise });
  this.logger.info(`Dispatched code-agent task ${task.id} (${task.name})`, {
    activeCount: this.activeCount,
  });
  return;
}
```

4. Add a private async method `runCodeAgentTask(task: NightShiftTask, startedAt: Date): Promise<TaskResult>`:

```ts
private async runCodeAgentTask(task: NightShiftTask, startedAt: Date): Promise<TaskResult> {
  try {
    const timeoutMs = parseTimeout(task.timeout);
    const result = await runCodeAgent(this.codeAgentConfig!, this.configDir, {
      gitlabToken: process.env.GITLAB_TOKEN,
      timeoutMs,
      logger: this.logger,
    });

    const agentResult: AgentExecutionResult = {
      sessionId: "",
      durationMs: result.totalDurationMs,
      totalCostUsd: result.totalCostUsd,
      result: this.formatCodeAgentResult(result),
      isError: false,
      numTurns: 0,
    };

    const taskResult: TaskResult = { task, result: agentResult, startedAt, completedAt: new Date() };
    this.running.delete(task.id);
    this.completedQueue.push(taskResult);
    return taskResult;
  } catch (err) {
    const completedAt = new Date();
    const taskResult: TaskResult = {
      task,
      result: {
        sessionId: "",
        durationMs: completedAt.getTime() - startedAt.getTime(),
        totalCostUsd: 0,
        result: err instanceof Error ? err.message : String(err),
        isError: true,
        numTurns: 0,
      },
      startedAt,
      completedAt,
    };
    this.running.delete(task.id);
    this.completedQueue.push(taskResult);
    return taskResult;
  }
}
```

5. Add a private method `formatCodeAgentResult` that converts `CodeAgentRunResult` to a human-readable string for inbox reports and notifications:

```ts
private formatCodeAgentResult(result: import("../agent/types.js").CodeAgentRunResult): string {
  switch (result.outcome) {
    case "MR_CREATED":
      return `MR created: ${result.mrUrl ?? "unknown URL"} (category: ${result.categoryUsed})`;
    case "NO_IMPROVEMENT":
      return `No improvement found (category: ${result.categoryUsed}). ${result.reason ?? ""}`.trim();
    case "ABANDONED":
      return `Abandoned after retries (category: ${result.categoryUsed}). ${result.reason ?? ""}`.trim();
  }
}
```

6. Import `parseTimeout` from `"../utils/process.js"`.

**Orchestrator changes (`src/daemon/orchestrator.ts`):**

1. Import `path` from `"node:path"` and `getConfigPath` from `"../core/paths.js"` (getConfigPath is already used by loadConfig internally, but we need the config dir).

2. In the `start()` method, when constructing `AgentPool`, pass the additional fields:
```ts
this.pool = new AgentPool({
  maxConcurrent: this.config.maxConcurrent,
  workspaceDir,
  logger: this.logger,
  codeAgentConfig: this.config.codeAgent,
  configDir: path.dirname(getConfigPath()),
});
```

3. In the `tick()` method, after hot-reloading the config (where `this.config.recurring` and `this.config.defaultTimeout` are updated), also update the pool's code-agent config. Add a public method `updateCodeAgentConfig(config?: CodeAgentConfig)` to `AgentPool` that updates the stored `codeAgentConfig`. Call it in tick after the hot-reload succeeds:
```ts
this.pool.updateCodeAgentConfig(freshConfig.codeAgent);
```

Make `codeAgentConfig` a private (non-readonly) field in AgentPool so `updateCodeAgentConfig` can reassign it.

**Tests (`tests/unit/agent-pool.test.ts`):**

Add a new describe block `"code-agent dispatch"` with these tests:

1. **"dispatches code-agent task through runCodeAgent when isCodeAgent=true and codeAgentConfig provided"** — Mock `runCodeAgent` (vi.mock the `../../src/agent/code-agent.js` module), create pool with a `codeAgentConfig` fixture, dispatch a task with `isCodeAgent: true`, await drain, verify `runCodeAgent` was called (not the generic `AgentRunner.run`), and the result is adapted to `AgentExecutionResult`.

2. **"falls back to AgentRunner for tasks without isCodeAgent"** — Same pool with `codeAgentConfig`, but dispatch a task without `isCodeAgent` set. Verify `AgentRunner.run` is called (not `runCodeAgent`).

3. **"falls back to AgentRunner when codeAgentConfig is undefined"** — Pool without `codeAgentConfig`, dispatch task with `isCodeAgent: true`. Verify `AgentRunner.run` is called.

4. **"produces isError=true TaskResult when runCodeAgent throws"** — Mock `runCodeAgent` to reject. Verify the completed result has `isError: true`.

5. **"formats MR_CREATED result with MR URL"** — Mock `runCodeAgent` to return `{ outcome: "MR_CREATED", mrUrl: "https://gitlab.com/team/repo/-/merge_requests/42", ... }`. Verify result string contains the URL.

6. **"formats NO_IMPROVEMENT result with reason"** — Mock `runCodeAgent` to return `{ outcome: "NO_IMPROVEMENT", reason: "No test gaps found", ... }`. Verify result string contains the reason.

Use a minimal `CodeAgentConfig` fixture for the mock:
```ts
const mockCodeAgentConfig: CodeAgentConfig = {
  repoUrl: "git@gitlab.com:team/repo.git",
  confluencePageId: "123",
  categorySchedule: { monday: ["tests"] },
  prompts: { analyze: "./prompts/analyze.md", implement: "./prompts/implement.md", verify: "./prompts/verify.md", mr: "./prompts/mr.md", log: "./prompts/log.md" },
  allowedCommands: ["git", "sbt test"],
  variables: {},
};
```

To mock `runCodeAgent`, add a top-level `vi.mock`:
```ts
let mockRunCodeAgent = vi.fn();
vi.mock("../../src/agent/code-agent.js", () => ({
  runCodeAgent: (...args: unknown[]) => mockRunCodeAgent(...args),
}));
```
Reset `mockRunCodeAgent` in beforeEach.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/agent-pool.test.ts tests/unit/orchestrator.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>Code-agent tasks route through runCodeAgent. Generic tasks still use AgentRunner. Results are adapted to AgentExecutionResult. 6 new tests pass covering routing, fallback, error handling, and result formatting.</done>
</task>

<task type="auto">
  <name>Task 3: Verify full test suite and TypeScript compilation</name>
  <files></files>
  <action>
Run the full test suite and TypeScript type-check to confirm nothing is broken:

1. `npx tsc --noEmit` — must pass with zero errors
2. `npx vitest run` — all existing + new tests must pass

If any failures, fix them. Common issues to watch for:
- The `runner: null as any` cast in the code-agent dispatch path — if `RunningTask` interface uses `runner` for `killAll()`, ensure `killAll()` handles null runners gracefully (add a guard: `if (entry.runner) entry.runner.kill()`).
- Import paths must use `.js` extension (ESM convention in this project).
- The mock for `runCodeAgent` in tests must be compatible with the existing `AgentRunner` mock.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsc --noEmit 2>&1 | tail -5 && npx vitest run --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>TypeScript compiles with zero errors. All tests pass (existing + new). The daemon now correctly routes code-agent tasks through the 4-bead pipeline.</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes
- `npx vitest run` — all tests pass
- New tests in `agent-pool.test.ts` cover: code-agent routing, generic fallback, missing config fallback, error propagation, MR_CREATED formatting, NO_IMPROVEMENT formatting
- No changes to `src/agent/code-agent.ts` or `src/agent/code-agent-runner.ts` (those are already correct)
</verification>

<success_criteria>
- A recurring task named "code-agent" with `code_agent` config in nightshift.yaml triggers `runCodeAgent` (4-bead pipeline) through the daemon
- Generic recurring tasks and one-off tasks still use `AgentRunner` (`claude -p`)
- `CodeAgentRunResult` is adapted to `AgentExecutionResult` so inbox reports, ntfy notifications, and bead closing all work without changes
- GITLAB_TOKEN is forwarded from process.env to `runCodeAgent` (respecting the existing security invariant that only the MR bead receives it)
- Full test suite passes with 6+ new tests
</success_criteria>

<output>
After completion, create `.planning/quick/1-wire-runcodeagent-into-daemon/1-SUMMARY.md`
</output>

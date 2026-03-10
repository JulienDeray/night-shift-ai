---
phase: quick-5
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/submit.ts
  - tests/integration/submit.test.ts
autonomous: true
requirements: [SYNC-EXEC]
must_haves:
  truths:
    - "User can run `nightshift submit -a <agent> --sync` and see the agent execute in real-time"
    - "Without --sync, submit behaves exactly as before (queue only)"
    - "Synchronous execution shows per-bead progress and final summary"
    - "Non-zero exit code on agent failure in sync mode"
  artifacts:
    - path: "src/cli/commands/submit.ts"
      provides: "--sync flag implementation"
      contains: "sync"
    - path: "tests/integration/submit.test.ts"
      provides: "Tests for --sync flag behavior"
  key_links:
    - from: "src/cli/commands/submit.ts"
      to: "src/agent/engine.ts"
      via: "AgentEngine.run() call when --sync is set"
      pattern: "engine\\.run"
---

<objective>
Add a `--sync` flag to `nightshift submit` so it queues the task AND immediately executes the agent synchronously, streaming progress to the terminal. This bridges the gap where `submit` only queues and the user cannot watch execution without using the separate `run` command.

Purpose: Users who submit one-off tasks want the option to watch execution in real-time rather than checking status later.
Output: Updated submit command with --sync flag, integration tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/cli/commands/submit.ts
@src/cli/commands/run.ts
@tests/integration/submit.test.ts
@src/agent/engine.ts
@src/cli/formatters.ts

<interfaces>
From src/agent/engine.ts:
```typescript
export class AgentEngine {
  constructor(registry: BeadRegistry, logger: Logger) {}
  async run<T = unknown>(
    agentDir: string,
    agentsRoot: string,
    taskId: string,
    configOverrides?: Record<string, string>,
  ): Promise<AgentRunResult<T>> {}
}
```

From src/agent/bead-registry.ts:
```typescript
export class BeadRegistry {
  register(type: string, factory: BeadPluginFactory): void;
  resolve(type: string): BeadPluginFactory;
}
```

From src/agent/plugins/:
```typescript
// Two built-in plugins registered in run.ts:
import { StandardBeadPlugin } from "../../agent/plugins/standard-bead-plugin.js";
import { GitCloneBeadPlugin } from "../../agent/plugins/git-clone-bead-plugin.js";
```

From src/core/logger.ts:
```typescript
export class Logger {
  static createCliLogger(verbose?: boolean): Logger;
}
```

From src/cli/formatters.ts:
```typescript
export function success(msg: string): string;
export function error(msg: string): string;
export function info(msg: string): string;
export function formatDuration(seconds: number): string;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add --sync flag to submit command</name>
  <files>src/cli/commands/submit.ts, tests/integration/submit.test.ts</files>
  <behavior>
    - Test: `nightshift submit -a my-agent --sync` without a valid agent directory should exit non-zero (agent not found)
    - Test: `nightshift submit -a my-agent` (without --sync) still queues normally as before
    - Test: `nightshift submit -a my-agent --sync` prints "Running agent" to indicate synchronous execution started
  </behavior>
  <action>
    Add a `--sync` / `-s` boolean flag to the submit command. When `--sync` is provided:

    1. Still create the queue entry (file-based or bead) as before -- this preserves tracking
    2. After queuing, immediately execute the agent synchronously using the same pattern as `run.ts`:
       - Import `AgentEngine`, `BeadRegistry`, `StandardBeadPlugin`, `GitCloneBeadPlugin`, `Logger`
       - Create a CLI logger with `Logger.createCliLogger(true)` (verbose)
       - Build agent paths from config: `path.resolve(configDir, config.agentsDir)` and `path.join(agentsRoot, options.agent)`
       - Create registry, register "standard" and "git-clone" plugins
       - Call `engine.run(agentDir, agentsRoot, taskId)`
       - Display per-bead results with status and duration (reuse the display logic from run.ts)
       - Print final summary (agent name, duration, result preview)
       - Set `process.exitCode = 1` if agent status is not SUCCESS

    Extract the agent execution + result display logic into a shared helper function in a new file `src/cli/commands/_run-agent.ts` to avoid duplicating the ~50 lines of engine setup and result formatting between `run.ts` and `submit.ts`. Both commands should call this helper. The helper signature:

    ```typescript
    export async function runAgentForeground(options: {
      agentName: string;
      taskId: string;
      taskName: string;
      vars?: Record<string, string>;
      notify?: boolean;
      ntfyConfig?: NtfyConfig;
    }): Promise<AgentRunResult>;
    ```

    For the tests: add a new `describe` block "nightshift submit --sync" in the existing test file. Since we cannot set up a full valid agent in integration tests easily, test that:
    - The `--sync` flag is accepted without error (help output includes it)
    - Without `--sync`, existing behavior is unchanged (existing tests still pass)
    - With `--sync` and a non-existent agent, the command exits non-zero with an error message
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/integration/submit.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    - `nightshift submit -a agent --sync` executes the agent synchronously and shows real-time progress
    - `nightshift submit -a agent` (no --sync) behaves exactly as before
    - Shared helper eliminates duplication between run.ts and submit.ts
    - All existing and new tests pass
  </done>
</task>

</tasks>

<verification>
1. Run full test suite: `npm test` passes
2. Run typecheck: `npm run typecheck` passes
3. Manual: `nightshift submit --help` shows `--sync` option
4. Manual: `nightshift run --help` still works as before
</verification>

<success_criteria>
- `--sync` flag on submit triggers immediate foreground execution
- Without --sync, submit queues only (backward compatible)
- Shared helper between run.ts and submit.ts eliminates code duplication
- All tests pass, types check
</success_criteria>

<output>
After completion, create `.planning/quick/5-add-synchronous-agent-execution-support/5-SUMMARY.md`
</output>

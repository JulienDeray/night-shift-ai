---
phase: quick-6
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/cancel.ts
  - src/cli/index.ts
  - tests/integration/cancel.test.ts
autonomous: true
requirements: [QUICK-6]
must_haves:
  truths:
    - "User can cancel a pending task by ID and it is removed from the queue"
    - "User sees a confirmation message when cancellation succeeds"
    - "User sees a clear error when task ID does not exist or task is not pending"
    - "Cancel works for both file-based queue and beads-backed queue"
  artifacts:
    - path: "src/cli/commands/cancel.ts"
      provides: "Cancel command implementation"
    - path: "tests/integration/cancel.test.ts"
      provides: "Integration tests for cancel command"
  key_links:
    - from: "src/cli/index.ts"
      to: "src/cli/commands/cancel.ts"
      via: "addCommand(cancelCommand)"
      pattern: "cancelCommand"
---

<objective>
Add a `nightshift cancel <task-id>` command that removes/dequeues a pending task before the daemon picks it up.

Purpose: Users need a way to retract submitted tasks that haven't started executing yet, e.g. after submitting with wrong parameters.
Output: Working cancel command with integration tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
<!-- Key types and contracts the executor needs. -->

From src/core/types.ts:
```typescript
export type TaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "timed-out";
export interface NightShiftTask {
  id: string;
  name: string;
  status: TaskStatus;
  // ... other fields
}
```

From src/core/paths.ts:
```typescript
export function getQueueDir(base?: string): string;
```

From src/beads/client.ts:
```typescript
export class BeadsClient {
  async close(id: string): Promise<void>;
  async get(id: string): Promise<BeadEntry>;
  async listReady(): Promise<BeadEntry[]>;
}
```

From src/beads/types.ts:
```typescript
export interface BeadEntry {
  id: string;
  title: string;
  status: "open" | "closed";
  // ...
}
```

From src/cli/formatters.ts:
```typescript
export function success(text: string): string;
export function error(text: string): string;
export function warn(text: string): string;
```

From src/core/config.ts:
```typescript
export function loadConfig(): Promise<NightShiftConfig>;
```

From src/utils/fs.ts:
```typescript
export function readJsonFile<T>(filePath: string): Promise<T | null>;
```

CLI registration in src/cli/index.ts:
```typescript
import { Command } from "@commander-js/extra-typings";
program.addCommand(submitCommand);
// ... etc
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create cancel command with tests</name>
  <files>src/cli/commands/cancel.ts, src/cli/index.ts, tests/integration/cancel.test.ts</files>
  <behavior>
    - cancel with valid pending task ID removes the .json file from .nightshift/queue/ and prints success message
    - cancel with non-existent task ID exits non-zero and prints error
    - cancel requires a task-id argument (show usage error if missing)
    - cancel with a task that has status "running" exits non-zero and prints error that task is already running
    - command appears in --help output
  </behavior>
  <action>
    1. Create `src/cli/commands/cancel.ts`:
       - Export `cancelCommand` using `new Command("cancel")`
       - Accept required argument `<task-id>` (the ns-XXXXXXXX or bead ID)
       - Load config via `loadConfig()`
       - **Beads mode** (`config.beads.enabled`): Call `beads.close(taskId)` to cancel the bead. Wrap in try/catch — if the bead doesn't exist or is already closed, print error and set exitCode=1.
       - **File-based mode**: Read the queue directory (`getQueueDir()`), look for `{taskId}.json`. If found, read the task JSON. If `status === "pending"`, delete the file with `fs.unlink()` and print success. If status is "running", print error that task is already being executed. If file not found, print error that task ID was not found.
       - Use `success()`, `error()` formatters from `../formatters.js` for consistent output.
       - Print the cancelled task name in the success message: `"Cancelled task: {taskName} ({taskId})"`

    2. Register in `src/cli/index.ts`:
       - Import `cancelCommand` from `./commands/cancel.js`
       - Add `program.addCommand(cancelCommand)` alongside other commands

    3. Create `tests/integration/cancel.test.ts` following the exact pattern from `tests/integration/submit.test.ts`:
       - Same tmpDir setup, `run()` helper using `spawnWithTimeout`, `writeConfig()`, `beforeEach`/`afterEach`
       - Same `readQueuedTasks()` helper
       - Tests:
         a. Submit a task, then cancel it by ID — queue should be empty, output contains "Cancelled"
         b. Cancel a non-existent ID — exitCode non-zero, output contains error message
         c. Submit two tasks, cancel one — only one remains in queue
         d. Cancel a running task (manually write a task.json with status "running") — exitCode non-zero, output mentions "running"
         e. `cancel --help` shows the task-id argument
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/integration/cancel.test.ts</automated>
  </verify>
  <done>
    - `nightshift cancel <task-id>` removes pending tasks from file-based queue
    - `nightshift cancel <task-id>` closes beads in beads mode
    - Error cases handled: not found, already running
    - All integration tests pass
    - Command registered and visible in help
  </done>
</task>

</tasks>

<verification>
- `npx vitest run tests/integration/cancel.test.ts` — all tests pass
- `npx tsx bin/nightshift.ts cancel --help` — shows usage with task-id argument
- `npx tsc --noEmit` — no type errors
</verification>

<success_criteria>
- Cancel command removes pending file-based tasks by ID
- Cancel command closes beads by ID in beads mode
- Clear error messages for non-existent and already-running tasks
- Integration tests cover happy path and error cases
- Command registered in CLI and visible in help
</success_criteria>

<output>
After completion, create `.planning/quick/6-add-a-cancel-command-to-remove-dequeue-p/6-SUMMARY.md`
</output>

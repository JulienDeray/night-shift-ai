---
phase: quick-7
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/status.ts
  - tests/integration/status.test.ts
autonomous: true
requirements: [QUICK-7]
must_haves:
  truths:
    - "Running `nightshift status` with pending tasks shows a table listing each task with its ID, name, agent, and status"
    - "Running `nightshift status` with running tasks shows them in the same table with 'running' status"
    - "Running `nightshift status` with no tasks shows counts of 0 and no table"
  artifacts:
    - path: "src/cli/commands/status.ts"
      provides: "Enhanced status command with task table"
    - path: "tests/integration/status.test.ts"
      provides: "Integration tests for task listing"
  key_links:
    - from: "src/cli/commands/status.ts"
      to: "src/cli/formatters.ts"
      via: "table() formatter"
      pattern: "table\\("
---

<objective>
Enhance the `nightshift status` command so that in addition to showing aggregate counts (Pending: N, Running: N), it lists each individual pending and running task in a table with columns: ID, Name, Agent, Status, and Created.

Purpose: When multiple tasks are queued, the user currently only sees counts. They need to see individual task IDs to use `nightshift cancel <id>` and to understand what is pending/running.

Output: Updated status command and integration tests.
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
  origin: TaskOrigin;
  prompt: string;
  status: TaskStatus;
  timeout: string;
  createdAt: string;
  startedAt?: string;
  agentName?: string;
  // ... other fields
}
```

From src/cli/formatters.ts:
```typescript
export function table(headers: string[], rows: string[][]): string;
export function statusColor(status: TaskStatus | "completed" | "failed" | "timed-out"): string;
export function heading(text: string): string;
export function dim(text: string): string;
```

From src/core/paths.ts:
```typescript
export function getQueueDir(base?: string): string;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add failing tests for task listing in status output</name>
  <files>tests/integration/status.test.ts</files>
  <behavior>
    - Test: with pending tasks in queue, status output contains a table with task ID, name, agent name, and "pending" status
    - Test: with a running task in queue, status output shows the task with "running" status
    - Test: with multiple tasks (mix of pending and running), all appear in the output
    - Test: with zero tasks, no table is shown (just counts showing 0)
  </behavior>
  <action>
Add new test cases to the existing `tests/integration/status.test.ts` file. Follow the existing pattern: use `writeJsonFile` to create task JSON files in the `.nightshift/queue` directory with known IDs, names, agent names, and statuses, then run `nightshift status` and assert the output contains those values.

For the running task test, also write a fake daemon state file (like the existing "shows daemon info" test) so the daemon appears running.

Use the existing test helpers (`run()`, `writeConfig()`, `beforeEach`/`afterEach` setup).

Specific test cases:
1. "lists pending tasks with ID, name, and agent" -- create 2 pending tasks with known IDs (e.g. "ns-aaa00001", "ns-aaa00002"), names ("lint-check", "deploy-staging"), and agentNames ("code-agent", "deploy-agent"). Assert stdout contains each ID, name, and agent name.
2. "lists running tasks when daemon is active" -- create a running task, write daemon state. Assert stdout contains the task ID and "running".
3. "shows no task table when queue is empty" -- just run status with no tasks. Assert stdout does NOT contain table separator character "---" or column headers like "ID".
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/integration/status.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>New tests exist and fail because the status command does not yet output individual task details</done>
</task>

<task type="auto">
  <name>Task 2: Enhance status command to list individual tasks in a table</name>
  <files>src/cli/commands/status.ts</files>
  <action>
Modify the Queue section of `src/cli/commands/status.ts` to list individual pending and running tasks in a table after the aggregate counts.

For the file-based queue path (the `else` branch where `config.beads.enabled` is false):

1. Collect all tasks from the queue directory (already iterating files). Instead of just counting `pending`, build an array of task objects for tasks with status "pending", "ready", or "running".
2. After printing the aggregate `Pending:` and `Running:` counts (keep those), if there are any pending/running tasks, print a blank line then a table using the existing `table()` formatter from `../formatters.js`.
3. Table columns: `ID`, `Name`, `Agent`, `Status`, `Created`
   - ID: `task.id`
   - Name: `task.name` (truncate to 30 chars if longer, append "...")
   - Agent: `task.agentName ?? "-"`
   - Status: use `statusColor(task.status)` for colored output
   - Created: use `formatDistanceToNow(new Date(task.createdAt))` + " ago"
4. Sort tasks: running first, then pending/ready, each group sorted by createdAt ascending.
5. If no pending/running tasks exist, do NOT print the table (just the counts showing 0).

For the beads-enabled path: leave as-is for now (beads client would need a different approach).

Import `table` from `../formatters.js` (already imported: `statusColor`, `formatCost`, `heading`, `dim`, `error` -- add `table` to that import).

Note: the `statusColor` function accepts "running" as a valid input (it matches the `TaskStatus` type). Use it directly.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/integration/status.test.ts</automated>
  </verify>
  <done>
    - `nightshift status` with pending/running tasks shows a table with ID, Name, Agent, Status, Created columns
    - Each task row displays its actual ID, name, agent, colored status, and relative creation time
    - Empty queue shows only "Pending: 0" / "Running: 0" with no table
    - All existing and new tests pass
  </done>
</task>

</tasks>

<verification>
Run the full status integration test suite:
```bash
npx vitest run tests/integration/status.test.ts
```

Manual smoke test (if daemon not running):
```bash
# Submit a task, then check status shows it
npx tsx bin/nightshift.ts submit --agent my-agent "test task"
npx tsx bin/nightshift.ts status
# Should show the task in a table with its ID
```
</verification>

<success_criteria>
- `nightshift status` displays individual pending/running tasks in a formatted table
- Task IDs are visible so users can copy them for `nightshift cancel <id>`
- Table includes ID, Name, Agent, Status, and Created columns
- No table is shown when queue is empty (clean output)
- All integration tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/7-enhance-status-command-to-list-individua/7-SUMMARY.md`
</output>

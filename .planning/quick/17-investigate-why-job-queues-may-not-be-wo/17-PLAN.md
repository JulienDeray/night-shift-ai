---
phase: quick-17
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/daemon/orchestrator.ts
  - src/daemon/scheduler.ts
  - tests/unit/scheduler.test.ts
autonomous: true
requirements: [QUICK-17]

must_haves:
  truths:
    - "Scheduled tasks that cannot be dispatched (pool full) are not silently dropped"
    - "Tasks that were returned by evaluateSchedules but not dispatched are retried on the next tick"
    - "Collecting completed tasks happens before dispatching new ones so freed slots are immediately available"
  artifacts:
    - path: "src/daemon/orchestrator.ts"
      provides: "Fixed tick order and task-drop protection"
    - path: "src/daemon/scheduler.ts"
      provides: "Scheduler that only marks tasks as ran after confirmation"
    - path: "tests/unit/scheduler.test.ts"
      provides: "Tests covering the pool-full scenario"
  key_links:
    - from: "src/daemon/orchestrator.ts"
      to: "src/daemon/scheduler.ts"
      via: "evaluateSchedules returns tasks, orchestrator confirms which were dispatched"
      pattern: "markDispatched|confirmRan|recordLastRun"
---

<objective>
Fix silent task dropping when the agent pool is full and reorder tick phases so freed slots are available immediately.

Purpose: Jobs scheduled at one-minute intervals are not all executing because (1) `evaluateSchedules()` updates `lastRuns` for ALL due tasks before the orchestrator checks pool capacity -- tasks that cannot be dispatched are silently lost, and (2) completed tasks are collected AFTER dispatching new ones, meaning freed slots are not available until the next tick.

Output: Fixed orchestrator tick ordering and scheduler that only records `lastRuns` for tasks that were actually dispatched.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/daemon/orchestrator.ts
@src/daemon/scheduler.ts
@src/daemon/agent-pool.ts
@tests/unit/scheduler.test.ts

<interfaces>
From src/daemon/scheduler.ts:
```typescript
interface SchedulerState {
  lastRuns: Record<string, string>; // `${agent}:${cron}` → ISO timestamp
}

export class Scheduler {
  updateConfig(config: NightShiftConfig): void;
  async loadState(base?: string): Promise<void>;
  async saveState(base?: string): Promise<void>;
  async evaluateSchedules(): Promise<NightShiftTask[]>;
}
```

From src/daemon/agent-pool.ts:
```typescript
export class AgentPool {
  get activeCount(): number;
  canAccept(): boolean;
  dispatch(task: NightShiftTask): void;
  collectCompleted(): TaskResult[];
  async drain(): Promise<TaskResult[]>;
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Split evaluateSchedules into evaluate + confirm, fix tick order</name>
  <files>src/daemon/scheduler.ts, src/daemon/orchestrator.ts, tests/unit/scheduler.test.ts</files>
  <behavior>
    - Test: When evaluateSchedules returns 3 due tasks but only 2 are confirmed via confirmDispatched, the third task is returned again on the next evaluateSchedules call
    - Test: When evaluateSchedules returns tasks and none are confirmed, all are returned again on the next call
    - Test: When all returned tasks are confirmed, none are returned on subsequent calls
    - Test: Existing tests continue to pass (seeding, skipping, variable merging, state persistence)
  </behavior>
  <action>
**Root cause:** `evaluateSchedules()` in scheduler.ts lines 82-83 updates `this.state.lastRuns[key] = now.toISOString()` for every due task, then saves state. The orchestrator at lines 234-238 breaks out of the dispatch loop when `pool.canAccept()` returns false. Tasks that were "evaluated" but not dispatched are permanently lost because lastRuns already recorded them.

**Fix the Scheduler (src/daemon/scheduler.ts):**

1. Change `evaluateSchedules()` so it does NOT update `lastRuns` for due tasks. Instead, return both the tasks AND metadata about which state keys they correspond to. Simplest approach: add a `pendingKeys` map (taskId -> key) as instance state.

2. Add a new method `confirmDispatched(taskIds: string[]): Promise<void>` that:
   - For each confirmed taskId, looks up its key in `pendingKeys` and updates `lastRuns[key]`
   - Removes confirmed entries from `pendingKeys`
   - Saves state if any updates were made
   - Tasks NOT confirmed remain eligible for the next `evaluateSchedules()` call (their lastRuns was never updated)

3. In `evaluateSchedules()`, still skip entries where `lastRun >= prevRun` (existing logic) but also skip entries that already have a pending undispatched task (check pendingKeys values against the key).

**Fix the Orchestrator (src/daemon/orchestrator.ts) tick() method:**

1. Reorder steps: collect completed FIRST (step 2 becomes step 0), then evaluate schedules, then poll file queue. This frees pool slots before trying to dispatch new work.

2. After the scheduled task dispatch loop, call `this.scheduler.confirmDispatched(dispatchedIds)` with only the IDs that were actually dispatched.

**Update tests (tests/unit/scheduler.test.ts):**

1. Add test for the pool-full scenario: evaluateSchedules returns tasks, only some are confirmed, unconfirmed ones reappear.
2. Update existing tests that call `evaluateSchedules()` to also call `confirmDispatched()` where tasks were expected to be created (to maintain the "task was handled" semantics). The `seedScheduler` helper does not need changes since seeding produces 0 tasks.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/scheduler.test.ts</automated>
  </verify>
  <done>
    - evaluateSchedules no longer updates lastRuns directly for due tasks
    - confirmDispatched method exists and updates lastRuns only for confirmed task IDs
    - Unconfirmed tasks reappear on subsequent evaluateSchedules calls
    - Orchestrator collects completed tasks before dispatching new ones
    - Orchestrator calls confirmDispatched with only actually-dispatched task IDs
    - All existing and new scheduler tests pass
  </done>
</task>

<task type="auto">
  <name>Task 2: Add orchestrator-level integration test for pool-full scenario</name>
  <files>tests/unit/orchestrator-tick.test.ts</files>
  <action>
Create a focused unit test for the orchestrator's tick method that verifies the end-to-end fix:

1. Create a test file `tests/unit/orchestrator-tick.test.ts` that tests the tick logic in isolation by:
   - Creating a Scheduler with 3 schedule entries all due at the same time (e.g., 3 agents each with `* * * * *` cron)
   - Creating an AgentPool with maxConcurrent=1
   - Mocking AgentEngine.run to resolve immediately with a SUCCESS result
   - Simulating multiple tick cycles

2. Test cases:
   - "tick dispatches as many scheduled tasks as pool allows, remaining tasks are not lost": Set up 3 due schedules with maxConcurrent=1. First tick should dispatch 1 task. Verify the other 2 are not lost by advancing time and calling tick again after the first task completes.
   - "tick collects completed tasks before dispatching new ones": Dispatch a task in tick 1, let it complete, verify tick 2 can immediately dispatch a new task (no wasted tick).

Since the orchestrator's tick() is private and tightly coupled to config loading and file I/O, the cleanest approach is to test the Scheduler + orchestrator dispatch logic pattern directly rather than instantiating the full Orchestrator. Create helper functions that replicate the tick dispatch pattern (evaluate -> dispatch up to capacity -> confirm dispatched) and verify correctness.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/orchestrator-tick.test.ts</automated>
  </verify>
  <done>
    - Integration test proves that pool-full does not cause task loss
    - Integration test proves freed slots are immediately available
    - All tests pass
  </done>
</task>

</tasks>

<verification>
- `cd /Users/julienderay/code/night-shift && npx vitest run` — all tests pass
- `cd /Users/julienderay/code/night-shift && npx tsc --noEmit` — no type errors
</verification>

<success_criteria>
- Scheduled tasks that cannot be dispatched due to pool capacity are retried on subsequent ticks
- Completed tasks free up pool slots before new dispatch attempts in the same tick
- No regressions in existing scheduler or E2E tests
</success_criteria>

<output>
After completion, create `.planning/quick/17-investigate-why-job-queues-may-not-be-wo/17-SUMMARY.md`
</output>

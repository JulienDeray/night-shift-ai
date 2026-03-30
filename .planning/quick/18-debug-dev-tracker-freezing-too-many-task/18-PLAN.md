---
phase: quick-18
plan: 18
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/types.ts
  - src/core/config.ts
  - src/daemon/orchestrator.ts
  - tests/unit/orchestrator-tick.test.ts
  - tests/unit/config.test.ts
autonomous: true
requirements: [QUICK-18]

must_haves:
  truths:
    - "Daemon never spawns more than max_dispatches_per_tick new processes in a single tick cycle"
    - "max_dispatches_per_tick defaults to 2 when not set in config"
    - "Limit applies across both the cron schedule loop and the file queue loop combined"
    - "Existing maxConcurrent behaviour is unchanged"
  artifacts:
    - path: "src/core/types.ts"
      provides: "maxDispatchesPerTick field on NightShiftConfig"
    - path: "src/core/config.ts"
      provides: "max_dispatches_per_tick schema field with default 2"
    - path: "src/daemon/orchestrator.ts"
      provides: "per-tick dispatch cap enforced in tick()"
  key_links:
    - from: "src/core/config.ts mapConfig()"
      to: "NightShiftConfig.maxDispatchesPerTick"
      via: "raw.max_dispatches_per_tick"
    - from: "src/daemon/orchestrator.ts tick()"
      to: "this.config.maxDispatchesPerTick"
      via: "tickDispatches counter shared across both dispatch loops"
---

<objective>
Add a per-tick dispatch cap to the orchestrator so that starting many cron tasks simultaneously (e.g. after a daemon restart) cannot freeze the laptop by spawning 10+ heavy claude processes within milliseconds.

Purpose: Prevent system overload caused by burst-dispatching many tasks in a single tick cycle.
Output: New `max_dispatches_per_tick` config field (default 2) enforced in orchestrator tick(), with tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<!-- Key interfaces needed by executor -->
<interfaces>
From src/core/types.ts — NightShiftConfig (current shape, field to add):
```typescript
export interface NightShiftConfig {
  workspace: string;
  inbox: string;
  maxConcurrent: number;        // total running cap
  defaultTimeout: string;
  daemon: DaemonConfig;
  agentsDir: string;
  agents: AgentDeclaration[];
  schedule: ScheduleEntry[];
  oneOffDefaults: OneOffDefaults;
  ntfy?: NtfyConfig;
  // ADD: maxDispatchesPerTick: number
}
```

From src/core/config.ts — ConfigSchema (Zod, snake_case) and mapConfig():
- Schema uses z.object({ max_concurrent: ..., ... }).strict()
- mapConfig() maps snake_case raw fields to camelCase NightShiftConfig
- ADD max_dispatches_per_tick: z.number().int().positive().default(2) to ConfigSchema
- ADD maxDispatchesPerTick: raw.max_dispatches_per_tick to mapConfig()

From src/daemon/orchestrator.ts — tick() dispatch loops (lines 220-268):
- Phase 2: cron schedule loop — for (const task of scheduledTasks) { if (!pool.canAccept()) break; ... }
- Phase 3: file queue loop — for (const task of readyTasks) { if (!pool.canAccept()) break; ... }
- ADD: let tickDispatches = 0 before phase 2
- Both loops: also break if tickDispatches >= this.config.maxDispatchesPerTick
- Increment tickDispatches each time pool.dispatch() is called

From tests/unit/orchestrator-tick.test.ts — simulateTick() pattern (lines 104-128):
- Uses MockPool + Scheduler
- makeConfig() helper builds NightShiftConfig with overrides
- Tests dispatch behaviour by inspecting dispatched[] and notDispatched[] arrays
- ADD new describe block testing that maxDispatchesPerTick limits dispatches
  even when pool has more capacity
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add max_dispatches_per_tick config field</name>
  <files>src/core/types.ts, src/core/config.ts, tests/unit/config.test.ts</files>
  <behavior>
    - config.test.ts: test that omitting max_dispatches_per_tick defaults to 2 in parsed NightShiftConfig
    - config.test.ts: test that setting max_dispatches_per_tick: 5 parses to maxDispatchesPerTick: 5
    - config.test.ts: test that max_dispatches_per_tick: 0 fails Zod validation (must be positive integer)
  </behavior>
  <action>
    1. In src/core/types.ts, add `maxDispatchesPerTick: number` to NightShiftConfig after maxConcurrent.
    2. In src/core/config.ts ConfigSchema, add `max_dispatches_per_tick: z.number().int().positive().default(2)` after max_concurrent. The schema uses .strict() so adding the field is all that is needed.
    3. In mapConfig(), add `maxDispatchesPerTick: raw.max_dispatches_per_tick` to the returned object.
    4. Write failing tests first in tests/unit/config.test.ts, then implement until tests pass.
    Note: makeConfig() in orchestrator-tick.test.ts will need maxDispatchesPerTick added to its defaults too (add it there as a follow-up in Task 2 to avoid cross-file churn here).
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/config.test.ts</automated>
  </verify>
  <done>Config schema accepts max_dispatches_per_tick, defaults to 2, rejects non-positive values. NightShiftConfig type has the field.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Enforce per-tick dispatch cap in orchestrator</name>
  <files>src/daemon/orchestrator.ts, tests/unit/orchestrator-tick.test.ts</files>
  <behavior>
    - When pool.canAccept() is true for 5 slots but maxDispatchesPerTick is 2, only 2 tasks are dispatched per tick across both loops combined
    - When cron loop dispatches 2 tasks (hitting the cap), the file queue loop dispatches 0 even if pool has capacity
    - When cron loop dispatches 1 task and cap is 2, the file queue loop can dispatch 1 more
    - Tasks not dispatched due to the per-tick cap are NOT confirmed (remain retryable next tick — existing behaviour via confirmDispatched)
  </behavior>
  <action>
    1. Update makeConfig() in tests/unit/orchestrator-tick.test.ts to include `maxDispatchesPerTick: 2` as a default (matching the new type field).
    2. Add a new describe block "per-tick dispatch cap" in orchestrator-tick.test.ts with tests for the behaviours above. Write tests FIRST (they should fail because the cap is not yet implemented).
    3. In src/daemon/orchestrator.ts tick(), add `let tickDispatches = 0` before phase 2 (the cron schedule loop).
    4. In the cron schedule loop (phase 2), add a second break condition: `if (tickDispatches >= this.config.maxDispatchesPerTick) break;` alongside the existing `if (!this.pool.canAccept()) break;`. Increment `tickDispatches++` after each pool.dispatch() call.
    5. In phase 3 (file queue loop), add the same guard at the top of the outer if block: `if (tickDispatches >= this.config.maxDispatchesPerTick)` skip the loop entirely. Inside the loop, also add the break check and increment tickDispatches after each dispatch.
    6. Log a debug message when the per-tick cap is hit: `this.logger.debug("Per-tick dispatch cap reached", { limit: this.config.maxDispatchesPerTick })`.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/orchestrator-tick.test.ts</automated>
  </verify>
  <done>All orchestrator-tick tests pass. Per-tick cap limits dispatches to maxDispatchesPerTick across cron + queue loops. Remaining tests unaffected.</done>
</task>

</tasks>

<verification>
Full unit test suite passes:

```
cd /Users/julienderay/code/night-shift && npx vitest run
```

No TypeScript errors:

```
cd /Users/julienderay/code/night-shift && npx tsc --noEmit
```
</verification>

<success_criteria>
- `maxDispatchesPerTick` field exists on NightShiftConfig with default 2
- `max_dispatches_per_tick` accepted in night-shift.yml config
- tick() never spawns more than maxDispatchesPerTick new processes per cycle
- All existing tests continue to pass
- New tests cover cap enforcement across both dispatch loops
</success_criteria>

<output>
After completion, create `.planning/quick/18-debug-dev-tracker-freezing-too-many-task/18-SUMMARY.md`
</output>

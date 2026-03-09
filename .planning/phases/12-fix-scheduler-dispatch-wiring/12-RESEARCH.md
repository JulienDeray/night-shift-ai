# Phase 12: Fix Scheduler Dispatch Wiring - Research

**Researched:** 2026-03-09
**Domain:** Daemon orchestrator wiring (TypeScript, internal codebase)
**Confidence:** HIGH

## Summary

This phase fixes a single integration bug: `orchestrator.ts` line 237 calls `await this.scheduler.evaluateSchedules()` but discards the returned `NightShiftTask[]`. The scheduler correctly builds tasks for due cron entries, but they are never dispatched to `AgentPool`.

The fix is mechanical: capture the return value and loop over it with the same `canAccept()` / `dispatch()` / `notifyTaskStart()` pattern already used at lines 246-257 for queue-based tasks. Scheduled tasks do not need `claimTask()` since they originate from cron evaluation, not from a file queue.

**Primary recommendation:** Capture the `evaluateSchedules()` return value into a local `scheduledTasks` variable, iterate with `canAccept()` guard, call `pool.dispatch()` and `notifyTaskStart()` for each. Add a unit test that verifies this flow end-to-end with mocked scheduler and pool.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None explicitly locked -- all technical decisions deferred to Claude.

### Claude's Discretion
- Capacity handling: follow existing patterns (check `pool.canAccept()` before dispatching, skip if full -- next cron tick retries)
- Notification behavior: follow existing pattern (call `notifyTaskStart()` for dispatched scheduled tasks, same as manual dispatches)
- Dispatch ordering and error handling: consistent with existing poll-based dispatch at lines 246-257
- All technical decisions deferred to Claude -- this is a straightforward wiring fix

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIRE-01 | `AgentPool.dispatch()` routes tasks with `agentName` to `AgentEngine` instead of hardcoded `runCodeAgent` | AgentPool.dispatch() already routes via AgentEngine (done in Phase 10). The remaining gap is that orchestrator.ts discards the evaluateSchedules() return value, so scheduled tasks never reach dispatch(). Fix is in orchestrator.ts tick() method only. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project default) | Unit test framework | Already used for all tests in project |
| TypeScript | (project default) | Type safety | Project language |

### Supporting
No new libraries needed. This is a pure wiring fix within existing code.

## Architecture Patterns

### The Bug (orchestrator.ts:237)

Current code in `tick()`:
```typescript
// 1. Evaluate cron schedules
await this.scheduler.evaluateSchedules();  // <-- return value DISCARDED
```

### The Fix Pattern

Replicate the dispatch pattern from lines 246-257, minus `claimTask()`:

```typescript
// 1. Evaluate cron schedules -> dispatch due tasks
const scheduledTasks = await this.scheduler.evaluateSchedules();
for (const task of scheduledTasks) {
  if (!this.pool.canAccept()) break;
  this.pool.dispatch(task);
  this.notifyTaskStart(task);
}
```

Key differences from the queue-based dispatch (lines 246-257):
- **No `claimTask()`** -- scheduled tasks are created by the scheduler, not read from a file queue
- **No outer `canAccept()` guard** -- the loop's inner check is sufficient, but adding one is fine for consistency
- Placed BEFORE the queue-based dispatch so scheduled tasks get priority (they have a cron window)

### Established Dispatch Pattern (lines 246-257)
```typescript
if (this.pool.canAccept()) {
  const readyTasks = await this.getReadyTasks();
  for (const task of readyTasks) {
    if (!this.pool.canAccept()) break;
    const claimed = await this.claimTask(task);
    if (claimed) {
      this.pool.dispatch(task);
      this.notifyTaskStart(task);
    }
  }
}
```

### Fallback Dispatch Pattern (line 402-416)
```typescript
if (this.pool.canAccept()) {
  this.pool.dispatch(fallbackTask);
}
```

### Anti-Patterns to Avoid
- **Queueing scheduled tasks to a file** -- they should be dispatched directly, not written to the queue directory
- **Wrapping in try/catch differently from queue dispatch** -- keep error handling consistent; `evaluateSchedules()` already handles its own errors internally

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron evaluation | Custom cron parser | `Scheduler.evaluateSchedules()` | Already implemented and tested (14 tests) |
| Task dispatch | Custom dispatch logic | `AgentPool.dispatch()` | Already routes to AgentEngine correctly |
| Capacity checking | Custom concurrency logic | `pool.canAccept()` | Handles maxConcurrent tracking |

## Common Pitfalls

### Pitfall 1: Dispatching Without canAccept() Check
**What goes wrong:** Pool logs a warning and silently drops the task
**Why it happens:** AgentPool.dispatch() has its own guard but just logs and returns
**How to avoid:** Always check `pool.canAccept()` before calling `dispatch()`, with a `break` to skip remaining tasks
**Warning signs:** "Pool full, cannot accept task" warnings in daemon logs

### Pitfall 2: Forgetting notifyTaskStart()
**What goes wrong:** User configured ntfy notifications for scheduled tasks but gets no start notifications
**Why it happens:** Easy to dispatch without calling the notification hook
**How to avoid:** Call `this.notifyTaskStart(task)` immediately after `this.pool.dispatch(task)`, matching the pattern at line 255

### Pitfall 3: Calling claimTask() on Scheduled Tasks
**What goes wrong:** Scheduler-created tasks don't exist in the file queue, so claimTask() would fail for file-based mode or create phantom bead claims
**Why it happens:** Copy-pasting the queue dispatch block without understanding the difference
**How to avoid:** Scheduled tasks skip claiming -- they originate from evaluateSchedules(), not from getReadyTasks()

### Pitfall 4: Testing tick() Directly
**What goes wrong:** tick() is private and calls loadConfig() which needs a real config file
**Why it happens:** Attempting to test the wiring through the Orchestrator class
**How to avoid:** Test the wiring by composing Scheduler + AgentPool directly in a unit test, verifying that evaluateSchedules() output flows to dispatch(). Alternatively, test via private method access with (orchestrator as any) -- the project already uses this pattern extensively (see orchestrator.test.ts lines 325-387)

## Code Examples

### Current tick() Method (the bug site)
```typescript
// Source: src/daemon/orchestrator.ts:224-263
private async tick(): Promise<void> {
  // 0. Hot-reload defaultTimeout from config
  // ... (lines 226-234)

  // 1. Evaluate cron schedules
  await this.scheduler.evaluateSchedules();  // BUG: return value discarded

  // 2. Collect completed tasks
  const completed = this.pool.collectCompleted();
  // ...

  // 3. Poll for ready tasks and dispatch
  if (this.pool.canAccept()) {
    const readyTasks = await this.getReadyTasks();
    for (const task of readyTasks) {
      if (!this.pool.canAccept()) break;
      const claimed = await this.claimTask(task);
      if (claimed) {
        this.pool.dispatch(task);
        this.notifyTaskStart(task);
      }
    }
  }
  // ...
}
```

### Scheduler.evaluateSchedules() Return Type
```typescript
// Source: src/daemon/scheduler.ts:37
async evaluateSchedules(): Promise<NightShiftTask[]>
```

Returns fully-formed `NightShiftTask` objects with `agentName`, `variables`, `notify`, `origin: "recurring"` -- ready for direct dispatch.

### AgentPool.dispatch() Signature
```typescript
// Source: src/daemon/agent-pool.ts:58
dispatch(task: NightShiftTask): void
```

Accepts any NightShiftTask. Rejects tasks without `agentName` by pushing a FATAL result to completedQueue.

### Test Pattern Used in Project
```typescript
// Source: tests/unit/orchestrator.test.ts - pattern for accessing private methods
(orchestrator as any).ntfy = mockNtfy;
(orchestrator as any).notifyTaskStart(task);
```

### Test Pattern for Scheduler + Pool Integration
```typescript
// Recommended test structure for the wiring fix
import { Scheduler } from "../../src/daemon/scheduler.js";
import { AgentPool } from "../../src/daemon/agent-pool.js";

// 1. Create scheduler with a due schedule entry
// 2. Call evaluateSchedules() to get tasks
// 3. For each task, dispatch to pool
// 4. Verify pool.activeCount increased / collectCompleted returns results
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project default) |
| Config file | vitest.config.ts (inferred from package.json scripts) |
| Quick run command | `npx vitest run tests/unit/orchestrator.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-01 | Scheduled tasks from evaluateSchedules() are dispatched to pool.dispatch() | unit | `npx vitest run tests/unit/orchestrator.test.ts -t "scheduled tasks"` | Needs new test |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/orchestrator.test.ts tests/unit/scheduler.test.ts tests/unit/agent-pool.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] New test in `tests/unit/orchestrator.test.ts` -- verifies evaluateSchedules() return flows through to pool.dispatch()

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/daemon/orchestrator.ts` (line 237 -- the bug)
- Direct code inspection of `src/daemon/scheduler.ts` (evaluateSchedules return type)
- Direct code inspection of `src/daemon/agent-pool.ts` (dispatch signature and behavior)
- Direct code inspection of existing test files (patterns and helpers)

### Secondary (MEDIUM confidence)
- CONTEXT.md phase discussion notes (confirmed the single-line fix scope)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, internal wiring fix only
- Architecture: HIGH - fix pattern directly mirrors existing dispatch code at lines 246-257
- Pitfalls: HIGH - all pitfalls derived from reading actual source code

**Research date:** 2026-03-09
**Valid until:** Stable -- internal codebase, no external dependency concerns

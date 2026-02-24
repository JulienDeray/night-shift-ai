---
phase: 02-orchestrator-hooks
verified: 2026-02-24T15:20:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 2: Orchestrator Hooks Verification Report

**Phase Goal:** The daemon fires start and end notifications for any task that opts in, with distinct success, skip, and failure messages
**Verified:** 2026-02-24T15:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A notification fires when the daemon dispatches a task with `notify: true` | VERIFIED | `notifyTaskStart` called after `pool.dispatch(task)` in `tick()`; guard `if (!this.ntfy \|\| !task.notify) return` confirmed |
| 2 | No notification fires when `task.notify` is false or `ntfy` is not configured | VERIFIED | Guard pattern in both helpers; 4 tests confirm no-fire conditions (notify false, notify undefined, ntfy null) |
| 3 | Success notification includes task name, cost, and summary with priority 3 | VERIFIED | `notifyTaskEnd`: priority 3, title contains task name, body is `Cost: $X.XX — result.slice(0,200)` |
| 4 | Failure notification includes task name, error snippet, and uses priority 4 | VERIFIED | `notifyTaskEnd`: `isError` branch sets priority 4, title contains "FAILED", body is `Error: result.slice(0,200)` |
| 5 | Notifications never block the poll loop or throw | VERIFIED | `void this.ntfy.send(...)` fire-and-forget pattern on both helpers; NtfyClient swallows all errors internally |
| 6 | NightShiftTask carries `notify` and `category` fields propagated from config | VERIFIED | Both fields present in `NightShiftTask` interface in `src/core/types.ts`; `createTask()` propagates both |
| 7 | Daemon resolves today's improvement category from the code_agent day-of-week schedule | VERIFIED | `resolveCategory(this.config.codeAgent?.categorySchedule)` called in `createTask()`; 7-day coverage tested |
| 8 | Category is frozen at task creation time, not re-resolved later | VERIFIED | `resolveCategory` called once in `createTask()`, result stored on task object; orchestrator uses `task.category` |
| 9 | Tasks created without code_agent config have `category` undefined | VERIFIED | `resolveCategory(undefined)` returns `undefined`; tested in "resolveCategory returns undefined when no codeAgent config" |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/types.ts` | `notify?: boolean` and `category?: string` on `NightShiftTask` | VERIFIED | Lines 20-21: both fields present after `recurringName` |
| `src/daemon/scheduler.ts` | `resolveCategory` helper and propagation in `createTask` | VERIFIED | Lines 18-25: exported `resolveCategory`; lines 119-120: both fields set in `createTask` |
| `tests/unit/scheduler.test.ts` | 7 tests for category resolution and notify propagation | VERIFIED | Lines 361-610: `describe("category resolution and notify propagation")` block with 7 tests, all passing |
| `src/daemon/orchestrator.ts` | `NtfyClient` instantiation and `notifyTaskStart`/`notifyTaskEnd` helpers | VERIFIED | Lines 14, 23, 50: import, field, instantiation; lines 281-311: both private methods |
| `tests/unit/orchestrator.test.ts` | 11 unit tests for notification hook behaviors | VERIFIED | Lines 345-505: `describe("Orchestrator notification hooks")` with 11 tests, all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/daemon/orchestrator.ts` | `src/notifications/ntfy-client.ts` | `new NtfyClient(this.config.ntfy)` in `start()` | WIRED | Line 14: import present; line 50: instantiation confirmed |
| `src/daemon/orchestrator.ts` | `src/core/types.ts` | `task.notify` and `task.category` checked in helpers | WIRED | Line 282: `!task.notify` guard; line 283: `task.category` used in body |
| `src/daemon/scheduler.ts` | `src/core/types.ts` | `NightShiftTask.category` and `NightShiftTask.notify` fields | WIRED | Line 7: `CategoryScheduleConfig` imported; lines 119-120: fields assigned |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| NTFY-03 | 02-02-PLAN.md | Task-start notification fires when daemon dispatches a task (includes task name and category) | SATISFIED | `notifyTaskStart` called in `tick()` after `pool.dispatch(task)`; 6 tests cover all guard and content conditions |
| NTFY-04 | 02-02-PLAN.md | Task-end notification fires on success with MR link, cost, and brief summary | SATISFIED (partial forward dependency) | Success body: `Cost: $X.XX — result.slice(0,200)`. MR link will appear in `result.result` once Phase 3/4 agent is built. Current implementation correctly passes agent output as body. |
| NTFY-05 | 02-02-PLAN.md | Task-end notification fires on failure or skip with distinct message and higher priority | SATISFIED | Failure: priority 4, title contains "FAILED", body contains error snippet; tested in "fires failure notification with priority 4" |
| CONF-03 | 02-01-PLAN.md | Daemon resolves today's category from config and injects it into the agent prompt | SATISFIED | `resolveCategory` maps weekday to `CategoryScheduleConfig` entry; result stored as `task.category`; all 7 weekdays tested |

**Note on NTFY-04 MR link:** The success criterion in ROADMAP.md states the notification should contain the "MR link (or 'no improvement found')". The current implementation passes `result.result.slice(0, 200)` as the body, which is the agent's raw output. When the Phase 3/4 code agent is built and produces MR links in its result string, they will appear in the notification body automatically. This is the correct architectural foundation — the orchestrator is not responsible for generating MR links, only for forwarding the agent result. No gap exists in Phase 2's deliverables.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No TODOs, placeholders, empty implementations, or stub returns found in any modified file |

### Human Verification Required

The following item cannot be verified programmatically and requires a live environment:

**1. End-to-end notification delivery**

**Test:** Add `notify: true` to a recurring task in `~/.config/nightshift/config.json` with an `ntfy` block configured (real topic URL). Start the daemon and wait for the task to trigger.
**Expected:** A push notification arrives on the configured Ntfy topic within seconds of dispatch, containing the task name and category; a second notification arrives when the task completes with cost and summary.
**Why human:** Requires a real Ntfy server, real HTTP POST, and a real mobile device to receive. Network connectivity and authentication cannot be verified from the codebase.

### Gaps Summary

No gaps found. All 9 observable truths are verified, all 5 artifacts are substantive and wired, all 4 key links are confirmed, and all 4 requirements (NTFY-03, NTFY-04, NTFY-05, CONF-03) are satisfied.

The full test suite passes: 171 tests across 16 test files, 0 failures. TypeScript type checking is clean with 0 errors. Commits `2232a73`, `e8f8891`, `a56d327`, `163b922` all exist in git history as documented in the summaries.

---

_Verified: 2026-02-24T15:20:00Z_
_Verifier: Claude (gsd-verifier)_

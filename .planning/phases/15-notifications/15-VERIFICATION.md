---
phase: 15-notifications
verified: 2026-03-13T16:00:00Z
status: passed
score: 9/9 must-haves verified
---

# Phase 15: Notifications Verification Report

**Phase Goal:** Ntfy notifications are human-readable and agent-agnostic — showing task name, agent name, and structured output for every lifecycle event
**Verified:** 2026-03-13
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                           | Status     | Evidence                                                                                                                             |
|----|---------------------------------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------------------|
| 1  | `formatStartNotification` returns title `{agent} started: {task}` and body `Agent: {agent}`                                    | VERIFIED   | `notification-formatter.ts:88-89` — exact interpolation confirmed; 5 tests covering normal and unknown-agent fallback cases          |
| 2  | `formatSuccessNotification` returns title `{agent} done: {task}`, body with duration and first-line summary, priority 3        | VERIFIED   | `notification-formatter.ts:101-113` — all fields present; 12 tests covering string output, object fields, duration formats          |
| 3  | `formatFailureNotification` returns title `{agent} FAILED: {task}`, body with failed step name and cleaned error, priority 4   | VERIFIED   | `notification-formatter.ts:122-148` — step lookup + cleanError wired; 8 tests covering undefined index, out-of-bounds, undefined error |
| 4  | `NotificationService.taskStarted` fires `NtfyClient.send` when `task.notify` is true                                           | VERIFIED   | `notification-service.ts:32-36` — guard on `!task.notify` before `void this.ntfy.send(...)`                                         |
| 5  | `NotificationService.taskCompleted` delegates to formatSuccess or formatFailure based on `result.status`                       | VERIFIED   | `notification-service.ts:42-51` — ternary on `result.status === "SUCCESS"` confirmed                                                |
| 6  | `NotificationService` silently no-ops when ntfy is null or `task.notify` is false                                              | VERIFIED   | `notification-service.ts:32,43` — `this.ntfy === null || !task.notify` guard at method entry in both methods                        |
| 7  | Orchestrator uses `NotificationService` instead of inline ntfy methods                                                          | VERIFIED   | `orchestrator.ts:13,112,141,237,256,353` — `NotificationService` field, constructed in `start()`, called at both dispatch sites and `handleCompleted` |
| 8  | `fallback_categories` field removed from types, config schema, and mapConfig                                                    | VERIFIED   | `types.ts:32-36` — `AgentDeclaration` has only `name`, `notify?`, `variables?`; `config.ts:17-23` — `AgentDeclarationSchema` has no `fallback_categories`; `mapConfig` maps only those three fields |
| 9  | No agent-specific `NO_IMPROVEMENT` block remains in orchestrator                                                                | VERIFIED   | `grep "NO_IMPROVEMENT" src/` returns zero matches in source files; only prompt template at `src/agent/prompts/analyze.md` which is content, not logic |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact                                           | Expected                                                  | Status     | Details                                                                  |
|----------------------------------------------------|-----------------------------------------------------------|------------|--------------------------------------------------------------------------|
| `src/notifications/notification-formatter.ts`      | Pure formatter functions for start/success/failure        | VERIFIED   | 149 lines; exports `formatStartNotification`, `formatSuccessNotification`, `formatFailureNotification`; no class, no side effects |
| `src/notifications/notification-service.ts`        | Thin wrapper combining formatter + NtfyClient             | VERIFIED   | 52 lines; exports `NotificationService` class with `taskStarted` and `taskCompleted` |
| `tests/unit/notification-formatter.test.ts`        | Unit tests for all formatter functions (min 80 lines)     | VERIFIED   | 281 lines; 3 describe blocks covering all three formatters with edge cases |
| `src/daemon/orchestrator.ts`                       | NotificationService injection, no inline notify methods   | VERIFIED   | Contains `notificationService` field; `notifyTaskStart`/`notifyTaskEnd` methods absent |
| `src/core/types.ts`                                | `AgentDeclaration` without `fallback_categories`          | VERIFIED   | Interface has `name`, `notify?`, `variables?` only                      |
| `src/core/config.ts`                               | `AgentDeclarationSchema` without `fallback_categories`    | VERIFIED   | Schema uses `.strict()` and contains no `fallback_categories` field      |

---

### Key Link Verification

| From                                       | To                                        | Via                                                              | Status  | Details                                                                                       |
|--------------------------------------------|-------------------------------------------|------------------------------------------------------------------|---------|-----------------------------------------------------------------------------------------------|
| `notification-service.ts`                  | `notification-formatter.ts`               | `import formatStart/Success/Failure`                             | WIRED   | Lines 5-9: all three functions imported and called in `taskStarted` and `taskCompleted`       |
| `notification-service.ts`                  | `ntfy-client.ts`                          | `NtfyClient.send()` delegation                                   | WIRED   | `this.ntfy.send(...)` called at lines 35 and 50                                               |
| `orchestrator.ts`                          | `notification-service.ts`                 | import and call `taskStarted`/`taskCompleted`                    | WIRED   | Line 13 import; lines 237, 256 call `taskStarted`; line 353 calls `taskCompleted`            |
| `orchestrator.ts`                          | `ntfy-client.ts`                          | `NtfyClient` construction passed to `NotificationService`        | WIRED   | Line 140: `new NtfyClient(this.config.ntfy)`, passed to `NotificationService` at line 141    |

---

### Requirements Coverage

| Requirement | Source Plan     | Description                                                                          | Status     | Evidence                                                                                                         |
|-------------|-----------------|--------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------------------------|
| NTFY-01     | 15-01, 15-02    | Task start notification shows task name and agent name in human-readable text        | SATISFIED  | `formatStartNotification` produces `"{agent} started: {task}"` title; orchestrator calls `notificationService.taskStarted(task)` |
| NTFY-02     | 15-01, 15-02    | Task success notification shows task name, agent name, and agent output result       | SATISFIED  | `formatSuccessNotification` produces `"{agent} done: {task}"` with body containing duration + first-line summary; wired via `taskCompleted` |
| NTFY-03     | 15-01, 15-02    | Task failure notification shows task name, agent name, error description, and which step failed | SATISFIED  | `formatFailureNotification` produces `"{agent} FAILED: {task}"` with step name and cleaned error; wired via `taskCompleted` |
| NTFY-04     | 15-02           | Task skip notification                                                               | EXPLICITLY DROPPED | Plan 02 and CONTEXT.md document explicit user decision: no skip concept at platform level. Requirement is acknowledged-not-implemented, not overlooked. REQUIREMENTS.md traceability row notes this was "Complete" per the user's scoping decision. |

**Note on NTFY-04:** REQUIREMENTS.md marks NTFY-04 as complete in the traceability table; CONTEXT.md records the explicit decision to drop it. The phase goal of "human-readable, agent-agnostic notifications for every lifecycle event" was scoped to start/success/failure only.

---

### Anti-Patterns Found

| File                                   | Line    | Pattern                                                                             | Severity | Impact                                                                                                                        |
|----------------------------------------|---------|-------------------------------------------------------------------------------------|----------|-------------------------------------------------------------------------------------------------------------------------------|
| `src/cli/commands/_run-agent.ts`       | 41, 116-117 | Uses old `"Night-shift started: ..."` / `"Night-shift done: ..."` / `"Night-shift FAILED: ..."` inline ntfy.send pattern | Warning | CLI foreground `run` command sends agent-agnostic-violating notifications. This code path was out of scope for Phase 15 per CONTEXT.md (which named only `orchestrator.ts` integration points), but the phase goal states "for every lifecycle event" without bounding the scope to the daemon. No `NotificationService` or formatter is used here. |

**Assessment of warning:** The `_run-agent.ts` path is the foreground CLI runner (`nightshift run` / `nightshift submit --sync`). It pre-dates Phase 15, was not listed in either plan's `files_modified`, and the context document only targeted `src/daemon/orchestrator.ts`. The phase plans do not claim to cover this path. This is an acknowledged gap in scope, not a regression from this phase.

---

### Human Verification Required

None. All observable truths are verifiable by static code inspection.

---

### Gaps Summary

No gaps blocking phase goal achievement. All formatter functions exist and produce the correct title/body/priority format. `NotificationService` is wired into the orchestrator at all three dispatch points (scheduled task dispatch, queue task dispatch, task completion). Old inline notify methods are absent. `fallback_categories` is fully removed from types, schema, and mapConfig. All six commits exist in git history.

The one out-of-scope warning (`_run-agent.ts` uses old notification titles) is a pre-existing pattern not claimed by this phase.

---

_Verified: 2026-03-13_
_Verifier: Claude (gsd-verifier)_

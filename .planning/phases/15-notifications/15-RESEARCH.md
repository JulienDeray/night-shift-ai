# Phase 15: Notifications - Research

**Researched:** 2026-03-13
**Domain:** TypeScript notification formatting, orchestrator refactoring, agent-agnostic architecture
**Confidence:** HIGH

## Summary

Phase 15 replaces minimal, agent-specific notification logic in the orchestrator with a clean, human-readable notification system. The existing code has two problems: notification titles use `Night-shift` instead of the agent name as prefix, and the orchestrator contains NO_IMPROVEMENT fallback re-dispatch logic that is tightly coupled to the code-agent's internal output schema — a violation of the platform's agent-agnostic principle.

The work is entirely internal TypeScript refactoring. No new external dependencies are needed. The `NtfyClient` transport layer stays untouched. The core deliverable is two new modules (`notification-formatter.ts` and `notification-service.ts`) inside `src/notifications/`, plus surgical removal of the fallback re-dispatch block and the `fallback_categories` field from config/types.

The existing test suite exercises the old `notifyTaskStart` / `notifyTaskEnd` methods directly via `(orchestrator as any)`. Those tests must be rewritten to exercise `NotificationService` instead, keeping the same behavioral coverage.

**Primary recommendation:** Build `NotificationFormatter` as a pure function module (no class needed), wrap it with `NotificationService`, inject `NotificationService` into `Orchestrator`, and delete the NO_IMPROVEMENT block. Tests live in `tests/unit/notification-formatter.test.ts` (pure logic) and the existing `tests/unit/orchestrator.test.ts` notification describe-blocks (updated to use the new service interface).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Message content — moderate detail level**
- Title uses agent name as prefix (not "Night-shift"): `code-agent done: nightly-refactor`
- Body includes: agent name, human-friendly duration (3m 42s), 1-line summary or error
- Start notification: title = `{agent} started: {task}`, body = `Agent: {agent}`
- Success notification: title = `{agent} done: {task}`, body = `{agent} • {duration}\n{first line of output}`
- Failure notification: title = `{agent} FAILED: {task}`, body = `{agent} • Step '{step}' failed\n{cleaned error message}`
- Priority: failures = 4 (high/urgent), start and success = 3 (default)
- Emoji tags via ntfy tags field: start, success, failure each get distinct emoji

**Output formatting**
- Success: first line of finalOutput (string) or extract `summary`/`result` field if finalOutput is an object, fallback to JSON.stringify — truncated to 200 chars
- Failure: cleaned-up error message (strip stack traces, show message line only) + which step failed from perStep data
- Duration: human-friendly format — `3m 42s` for minutes+seconds, `1h 2m` for longer runs

**Agent-agnostic principle**
- Drop NTFY-04 requirement entirely — no "skip" notification concept at the platform level
- Remove NO_IMPROVEMENT fallback re-dispatch logic from orchestrator
- Remove fallback_categories from agent config schema and nightshift.yaml
- Audit orchestrator during planning for any other agent-specific leaks (capture principle: orchestrator must be fully agent-agnostic)

**Architecture**
- New separate formatter module builds NtfyMessage from task + AgentRunResult
- New NotificationService wraps formatter + NtfyClient — orchestrator calls `notificationService.taskStarted(task)` / `notificationService.taskCompleted(task, result)`
- NtfyClient stays as pure transport layer (send JSON to ntfy endpoint)
- Orchestrator's inline notifyTaskStart/notifyTaskEnd methods replaced by NotificationService calls

**Ntfy actions**
- No action buttons on any notification type — keep it simple, no interactive elements
- NtfyAction interface can stay in NtfyClient for future use, but not wired into any notification

### Claude's Discretion
- Exact emoji tag choices per notification type
- NotificationService file location and naming
- Formatter implementation details (how to extract first line, how to clean errors)
- Whether to keep NtfyAction interface or remove unused code

### Deferred Ideas (OUT OF SCOPE)
- Fallback category re-dispatch as agent-internal logic (if an agent wants retry-with-different-category, it handles it in its own pipeline steps, not the platform)
- Action buttons on notifications (e.g., "View MR") — kept for future if needed
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NTFY-01 | Task start notification shows task name and agent name in human-readable text | `NotificationFormatter.formatStart(task)` — title = `{agentName} started: {taskName}`, body = `Agent: {agentName}` |
| NTFY-02 | Task success notification shows task name, agent name, and agent output result | `NotificationFormatter.formatSuccess(task, result)` — uses `finalOutput` string extraction or object field, truncated to 200 chars |
| NTFY-03 | Task failure notification shows task name, agent name, error description, and which step failed | `NotificationFormatter.formatFailure(task, result)` — uses `result.perStep[failedStepIndex].name` and cleaned `result.error` |
| NTFY-04 | **DROPPED** — per CONTEXT.md, skip is not a platform concept. Only NTFY-01/02/03 are implemented. | N/A |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (project) | ^5.7.0 | Static typing for formatter and service | Already in project |
| vitest | ^3.1.0 | Unit tests for formatter pure functions | Already in project — `npm test` runs all tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | Already a project dependency — could use for duration formatting | Only if the custom duration formatter is complex; the specified format (`3m 42s`, `1h 2m`) is simple arithmetic and needs no library |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure

```
src/notifications/
├── ntfy-client.ts          # UNCHANGED — pure transport
├── notification-formatter.ts  # NEW — pure functions, no side effects
└── notification-service.ts    # NEW — wraps formatter + NtfyClient
```

```
tests/unit/
├── ntfy-client.test.ts              # UNCHANGED
├── notification-formatter.test.ts   # NEW — covers formatter logic
└── orchestrator.test.ts             # UPDATED — notification describe-blocks rewritten
```

### Pattern 1: Pure Formatter Module

**What:** `notification-formatter.ts` exports plain functions (not a class) that take `NightShiftTask` and optionally `AgentRunResult` and return `NtfyMessage`. Zero side effects, fully testable.

**When to use:** Any time a function has no dependencies on external state or I/O.

**Example:**
```typescript
// src/notifications/notification-formatter.ts
import type { NightShiftTask } from "../core/types.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import type { NtfyMessage } from "./ntfy-client.js";

export function formatStartNotification(task: NightShiftTask): NtfyMessage {
  const agentName = task.agentName ?? "unknown-agent";
  return {
    title: `${agentName} started: ${task.name}`,
    body: `Agent: ${agentName}`,
    priority: 3,
    tags: ["clock1"],  // example — exact emoji tag at Claude's discretion
  };
}

export function formatSuccessNotification(task: NightShiftTask, result: AgentRunResult): NtfyMessage {
  const agentName = task.agentName ?? result.agentName;
  const duration = formatDuration(result.totalDurationMs);
  const summary = extractSummaryLine(result.finalOutput);
  return {
    title: `${agentName} done: ${task.name}`,
    body: `${agentName} \u2022 ${duration}\n${summary}`,
    priority: 3,
    tags: ["white_check_mark"],
  };
}

export function formatFailureNotification(task: NightShiftTask, result: AgentRunResult): NtfyMessage {
  const agentName = task.agentName ?? result.agentName;
  const duration = formatDuration(result.totalDurationMs);
  const failedStep = result.failedStepIndex !== undefined
    ? result.perStep[result.failedStepIndex]?.name ?? `step ${result.failedStepIndex}`
    : "unknown step";
  const cleanedError = cleanError(result.error);
  return {
    title: `${agentName} FAILED: ${task.name}`,
    body: `${agentName} \u2022 Step '${failedStep}' failed\n${cleanedError}`,
    priority: 4,
    tags: ["rotating_light"],
  };
}
```

### Pattern 2: NotificationService Thin Wrapper

**What:** `NotificationService` receives `NtfyClient | null` and `Logger`. Exposes `taskStarted(task)` and `taskCompleted(task, result)`. Internally determines success vs. failure from `result.status` and delegates to the formatter. Fire-and-forget (`void`) pattern preserved.

**Example:**
```typescript
// src/notifications/notification-service.ts
import type { NightShiftTask } from "../core/types.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import type { Logger } from "../core/logger.js";
import { NtfyClient } from "./ntfy-client.js";
import {
  formatStartNotification,
  formatSuccessNotification,
  formatFailureNotification,
} from "./notification-formatter.js";

export class NotificationService {
  constructor(
    private readonly ntfy: NtfyClient | null,
    private readonly logger: Logger,
  ) {}

  taskStarted(task: NightShiftTask): void {
    if (!this.ntfy || !task.notify) return;
    void this.ntfy.send(formatStartNotification(task), this.logger);
  }

  taskCompleted(task: NightShiftTask, result: AgentRunResult): void {
    if (!this.ntfy || !task.notify) return;
    const message = result.status === "SUCCESS"
      ? formatSuccessNotification(task, result)
      : formatFailureNotification(task, result);
    void this.ntfy.send(message, this.logger);
  }
}
```

### Pattern 3: Orchestrator Integration

**What:** Replace `private ntfy: NtfyClient | null` with `private notificationService: NotificationService | null`. Build `NotificationService` in `start()` after `NtfyClient` construction. Replace `notifyTaskStart(task)` call with `notificationService.taskStarted(task)` and `notifyTaskEnd(task, result)` with `notificationService.taskCompleted(task, result)`. Delete `notifyTaskStart` and `notifyTaskEnd` private methods.

**Key integration points (verified from source):**
- `orchestrator.ts:140` — `this.ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null;`
- `orchestrator.ts:236` — `this.notifyTaskStart(task);` (scheduled dispatch)
- `orchestrator.ts:255` — `this.notifyTaskStart(task);` (queue dispatch)
- `orchestrator.ts:381` — `this.notifyTaskEnd(task, result);`
- `orchestrator.ts:351-378` — NO_IMPROVEMENT fallback block to delete entirely

### Pattern 4: Helper Functions

**Duration formatting** (Claude's discretion, but specified format is clear):
```typescript
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
```

**Output summary extraction** (first line of string, or `summary`/`result` field from object):
```typescript
function extractSummaryLine(output: unknown): string {
  if (typeof output === "string") {
    return output.split("\n")[0].slice(0, 200);
  }
  if (output !== null && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    const candidate = obj["summary"] ?? obj["result"];
    if (typeof candidate === "string") return candidate.slice(0, 200);
  }
  return JSON.stringify(output)?.slice(0, 200) ?? "";
}
```

**Error cleaning** (strip stack traces, first meaningful line):
```typescript
function cleanError(error: string | undefined): string {
  if (!error) return "Unknown error";
  // Take the first non-empty line (message line), not stack frames
  const firstLine = error.split("\n").find((l) => l.trim().length > 0) ?? error;
  return firstLine.slice(0, 200);
}
```

### Anti-Patterns to Avoid

- **Parsing agent-specific output schemas:** Never check for `result.stepOutputs?.["analyze"]?.result === "NO_IMPROVEMENT"` in the orchestrator. This is the exact pattern being removed.
- **Hard-coding agent names:** The formatter must work identically for `code-agent`, `test-agent`, or any future agent. No conditional logic based on `task.agentName`.
- **Class for formatter:** Pure functions are simpler to test and have no initialization cost. Avoid wrapping them in a class.
- **Awaiting fire-and-forget notifications:** The existing pattern is `void this.ntfy.send(...)` — no await. Preserve this so notification failures never block the orchestrator.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Human-readable duration | Custom date library integration | Simple arithmetic (hours/minutes/seconds from ms) | The format (`3m 42s`) is fully deterministic; no locale or timezone concerns |
| Emoji selection | Emoji lookup tables | Hardcoded ntfy tag strings per notification type | ntfy accepts tag names as strings (`"white_check_mark"`, `"rotating_light"`, `"clock1"`) |
| Ntfy HTTP transport | Any custom fetch wrapper | Existing `NtfyClient.send()` | Already handles auth, error logging, timeout, fire-and-forget |

## Common Pitfalls

### Pitfall 1: Orchestrator Tests Break on Method Rename

**What goes wrong:** `orchestrator.test.ts` lines 322-460 test `(orchestrator as any).notifyTaskStart` and `(orchestrator as any).notifyTaskEnd` directly. After this phase those private methods no longer exist.

**Why it happens:** Tests access private internals via `as any` casting.

**How to avoid:** Plan must include rewriting the orchestrator notification describe-blocks to inject a mock `NotificationService` instead. The `notificationService` field replaces `ntfy` as the injectable mock target. All behavioral assertions (fires on `notify=true`, silent on `notify=false`, correct priority, body content) can be preserved.

**Warning signs:** TypeScript won't catch this — tests will fail at runtime with "not a function".

### Pitfall 2: `fallback_categories` Removal Cascade

**What goes wrong:** `fallback_categories` exists in 4 places: `AgentDeclaration` interface (types.ts), `AgentDeclarationSchema` (config.ts), `mapConfig` (config.ts), and `orchestrator.ts` (usage site). Missing one leaves a type error or dead field.

**How to avoid:** Remove in this order: (1) orchestrator usage, (2) `AgentDeclaration` interface, (3) `AgentDeclarationSchema` strict Zod schema, (4) `mapConfig`. The Zod schema uses `.strict()` so keeping the field in schema but removing from the TS interface (or vice versa) will cause type errors — use this as a safety net.

**Warning signs:** `tsc --noEmit` will catch the mismatch between Zod inferred type and mapped type.

### Pitfall 3: Config Test Covers `fallback_categories`

**What goes wrong:** `tests/unit/config.test.ts` may have tests that include `fallback_categories` in valid YAML fixture data. After removal, the Zod `.strict()` schema will reject those fixtures and tests will fail.

**How to avoid:** Search config.test.ts for `fallback_categories` before deletion. (Grep showed 0 hits in tests/ — confirmed safe as of research date.)

### Pitfall 4: `agentName` May Be `undefined` on Older Tasks

**What goes wrong:** `NightShiftTask.agentName` is typed `string | undefined`. The formatter must not produce `"undefined started: task-name"` in the title.

**How to avoid:** Fallback: `task.agentName ?? result.agentName` for completion notifications (result always carries agentName). For start notifications: `task.agentName ?? "unknown-agent"`.

### Pitfall 5: `failedStepIndex` Out of Bounds

**What goes wrong:** `result.failedStepIndex` may be set to an index that exceeds `result.perStep.length` (e.g., if a step fails before perStep is populated).

**How to avoid:** Use optional chaining: `result.perStep[result.failedStepIndex]?.name ?? \`step ${result.failedStepIndex}\``. If `failedStepIndex` is undefined, fall back to `"unknown step"`.

## Code Examples

### Current Notification Code (to be replaced)

```typescript
// orchestrator.ts:384-421 — CURRENT (replace this)
private notifyTaskStart(task: NightShiftTask): void {
  if (!this.ntfy || !task.notify) return;
  const body = task.agentName ? `Agent: ${task.agentName}` : "Running\u2026";
  void this.ntfy.send({ title: `Night-shift started: ${task.name}`, body, priority: 3 }, this.logger);
}

private notifyTaskEnd(task: NightShiftTask, result: AgentRunResult): void {
  if (!this.ntfy || !task.notify) return;
  const isFailure = result.status !== "SUCCESS";
  // ... sends with "Night-shift done:" / "Night-shift FAILED:" titles
}
```

### NO_IMPROVEMENT Block (to be removed — orchestrator.ts:351-378)

```typescript
// DELETE THIS ENTIRE BLOCK:
if (result.status === "SUCCESS" && task.agentName) {
  const analyzeOutput = result.stepOutputs?.["analyze"] as { result?: string; categoryUsed?: string } | undefined;
  if (analyzeOutput?.result === "NO_IMPROVEMENT") {
    const agentDecl = this.config.agents.find((a) => a.name === task.agentName);
    const fallbackCategories = agentDecl?.fallback_categories;
    // ... creates fallbackTask, dispatches it
  }
}
```

### Existing Test Pattern (to update in orchestrator.test.ts)

```typescript
// CURRENT (to replace):
(orchestrator as any).ntfy = mockNtfy;
(orchestrator as any).notifyTaskStart(task);

// NEW (inject NotificationService mock):
const mockService = { taskStarted: vi.fn(), taskCompleted: vi.fn() };
(orchestrator as any).notificationService = mockService;
await (orchestrator as any).tick();
expect(mockService.taskStarted).toHaveBeenCalledWith(task);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent-specific `NO_IMPROVEMENT` fallback in orchestrator | Agent handles its own retry/fallback in pipeline steps | Phase 15 | Orchestrator is fully agent-agnostic |
| `Night-shift` prefix in notification titles | Agent name as prefix | Phase 15 | Notifications are agent-attributed, not platform-attributed |
| Inline `notifyTaskStart` / `notifyTaskEnd` methods on Orchestrator | `NotificationService` injected into Orchestrator | Phase 15 | Cleaner separation of concerns, independently testable |

**Removed after this phase:**
- `fallback_categories` on `AgentDeclaration` / `AgentDeclarationSchema` / `mapConfig`
- `notifyTaskStart` / `notifyTaskEnd` private methods on `Orchestrator`
- NO_IMPROVEMENT fallback dispatch block (orchestrator.ts:351-378)
- `private ntfy: NtfyClient | null` replaced by `private notificationService: NotificationService | null`

## Open Questions

1. **Whether to keep `NtfyAction` interface in ntfy-client.ts**
   - What we know: It's unused by any notification in this phase (no action buttons)
   - What's unclear: Whether Phase 16 cleanup will flag it as dead code
   - Recommendation: Keep it — it's a 6-line interface with no runtime cost, and removing it could be a Phase 16 CLEAN task if desired.

2. **Exact emoji tag strings**
   - What we know: ntfy accepts tag name strings from the emoji shortcode list
   - What's unclear: Which three emoji tags best convey start/success/failure for this use case
   - Recommendation: Claude's discretion per CONTEXT.md. Reasonable defaults: `"clock1"` (start), `"white_check_mark"` (success), `"rotating_light"` (failure).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NTFY-01 | Start notification title = `{agent} started: {task}`, body has agent name | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-01 | `taskStarted` fires when `task.notify=true`, silent when false/null | unit | `npm test -- --reporter=dot tests/unit/orchestrator.test.ts` | ✅ (update required) |
| NTFY-02 | Success title = `{agent} done: {task}`, body has duration + first-line summary | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-02 | Success priority = 3 | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-02 | Object `finalOutput` extracts `summary`/`result` field | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-03 | Failure title = `{agent} FAILED: {task}`, body has step name + cleaned error | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-03 | Failure priority = 4 | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |
| NTFY-03 | Stack traces stripped from error message | unit | `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --reporter=dot tests/unit/notification-formatter.test.ts tests/unit/orchestrator.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/notification-formatter.test.ts` — covers NTFY-01/02/03 formatter pure functions (does not exist yet)

*(Existing `tests/unit/orchestrator.test.ts` exists and covers notification hooks — requires update, not creation)*

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `src/notifications/ntfy-client.ts` — NtfyMessage interface, NtfyClient.send() signature
- Direct source inspection: `src/agent/engine-types.ts` — AgentRunResult fields (finalOutput, perStep, failedStepIndex, totalDurationMs, error, stepOutputs, agentName)
- Direct source inspection: `src/daemon/orchestrator.ts` — exact line numbers of code to replace/delete
- Direct source inspection: `src/core/types.ts` — NightShiftTask, AgentDeclaration with fallback_categories
- Direct source inspection: `src/core/config.ts` — AgentDeclarationSchema with fallback_categories
- Direct source inspection: `tests/unit/orchestrator.test.ts` — existing notification test structure
- Direct source inspection: `tests/unit/ntfy-client.test.ts` — existing transport test (unchanged)

### Secondary (MEDIUM confidence)
- ntfy documentation (tag names): ntfy accepts emoji shortcode strings in `tags` array — verified against ntfy.sh docs conventions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing infrastructure
- Architecture: HIGH — verified by reading actual source files, exact line numbers identified
- Pitfalls: HIGH — derived from direct inspection of test files and type definitions
- Formatter logic: HIGH — all edge cases (undefined agentName, failedStepIndex bounds, object output) discovered from types

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable TypeScript codebase, no fast-moving dependencies)

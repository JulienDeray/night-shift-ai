# Phase 2: Orchestrator Hooks - Research

**Researched:** 2026-02-24
**Domain:** TypeScript daemon orchestration, notification lifecycle hooks, day-of-week category resolution
**Confidence:** HIGH

## Summary

Phase 2 wires the already-built `NtfyClient` (Phase 1) into the orchestrator's task dispatch and completion lifecycle. The work is purely integration — no new libraries, no new network clients, no config schema changes. Everything needed already exists: `NtfyClient` in `src/notifications/ntfy-client.ts`, `NtfyConfig` optional on `NightShiftConfig`, `notify?: boolean` on `RecurringTaskConfig`, and `CategoryScheduleConfig` with day-of-week arrays.

There are three well-defined insertion points in the existing code: (1) `Orchestrator.tick()` — just after `this.pool.dispatch(task)` to fire task-start notifications, (2) `Orchestrator.handleCompleted()` — at the end to fire success/failure end notifications, and (3) `Scheduler.createTask()` — where `notify` from `RecurringTaskConfig` must be propagated to `NightShiftTask` (currently missing). CONF-03 (category injection into task context) is also a scheduler responsibility: the resolved day-of-week category needs to be attached to the task so it can appear in notifications and, later, in the agent prompt.

The priority model for ntfy is numeric 1–5 (1=min, 3=default, 4=high, 5=max). Success should use priority 3 (default), failure/skip priority 4 (high). The day-of-week resolution uses `new Date().getDay()` (0=Sunday) mapped to the `CategoryScheduleConfig` weekday keys.

**Primary recommendation:** Add `notify?: boolean` and `category?: string` fields to `NightShiftTask`, propagate them from `RecurringTaskConfig` in the scheduler, then add a private `maybeNotify*` helper to the orchestrator that guards on both `this.config.ntfy` being defined and `task.notify === true`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NTFY-03 | Task-start notification fires when daemon dispatches a task (includes task name and category) | `Orchestrator.tick()` dispatches tasks; insert after `this.pool.dispatch(task)`; category comes from `task.category` once propagated |
| NTFY-04 | Task-end notification fires on success with MR link, cost, and brief summary | `Orchestrator.handleCompleted()` receives `AgentExecutionResult` with `totalCostUsd` and `result` (summary string); MR link parsed from result text or passed as "no improvement found" |
| NTFY-05 | Task-end notification fires on failure/skip with distinct message and higher priority | Same hook as NTFY-04; branch on `result.isError`; use `priority: 4` for failure path |
| CONF-03 | Daemon resolves today's category from config and injects it into the agent prompt | `Scheduler.createTask()` has access to `config.codeAgent.categorySchedule`; resolve via `new Date().getDay()`; store as `task.category` on `NightShiftTask` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | All work uses existing code | Zero new npm dependencies is a locked project decision |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `NtfyClient` (internal) | Phase 1 | HTTP POST to ntfy topic | Already built; `send(message, logger)` is fire-and-forget |
| Node.js built-in `Date` | — | Day-of-week resolution | `new Date().getDay()` returns 0–6 (Sunday=0) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `NtfyClient` instantiation in orchestrator | Singleton at orchestrator construction | Singleton is cleaner — ntfy config doesn't change at runtime, instantiate once in `start()` alongside `AgentPool` |
| Parsing MR link from result string | Structured output field on `AgentExecutionResult` | Structured field is cleaner but requires Phase 3 changes; for Phase 2 use result string as-is, label as "see summary" |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── notifications/
│   └── ntfy-client.ts        # existing — no changes needed
├── daemon/
│   ├── orchestrator.ts       # ADD: NtfyClient instantiation + maybeNotifyStart/End helpers
│   └── scheduler.ts          # ADD: category resolution + notify propagation to NightShiftTask
└── core/
    └── types.ts              # ADD: notify?: boolean and category?: string to NightShiftTask
```

### Pattern 1: Guard-and-delegate notification helpers

**What:** Private methods on `Orchestrator` that check `this.ntfy !== null && task.notify === true` before calling `this.ntfy.send()`. All notification logic is isolated in these helpers; the main `tick()` and `handleCompleted()` paths call them without branching.

**When to use:** Any time a conditional side-effect would otherwise pollute a primary flow method.

**Example:**
```typescript
// In Orchestrator class
private ntfy: NtfyClient | null = null;

async start(): Promise<void> {
  // ... existing init ...
  this.ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null;
}

private notifyTaskStart(task: NightShiftTask): void {
  if (!this.ntfy || !task.notify) return;
  void this.ntfy.send(
    {
      title: `Night-shift started: ${task.name}`,
      body: task.category ? `Category: ${task.category}` : "Running…",
      priority: 3,
    },
    this.logger,
  );
}

private notifyTaskEnd(task: NightShiftTask, result: AgentExecutionResult): void {
  if (!this.ntfy || !task.notify) return;
  const isFailure = result.isError;
  void this.ntfy.send(
    {
      title: isFailure
        ? `Night-shift FAILED: ${task.name}`
        : `Night-shift done: ${task.name}`,
      body: isFailure
        ? `Error: ${result.result.slice(0, 200)}`
        : `Cost: $${result.totalCostUsd.toFixed(2)} — ${result.result.slice(0, 200)}`,
      priority: isFailure ? 4 : 3,
    },
    this.logger,
  );
}
```

### Pattern 2: Category resolution at task creation time

**What:** In `Scheduler.createTask()`, resolve today's category from `config.codeAgent.categorySchedule` using `new Date().getDay()` before constructing the `NightShiftTask` object. Store as `task.category`.

**When to use:** Any data that must be frozen at dispatch time (not re-resolved at completion time).

**Example:**
```typescript
// In Scheduler.createTask()
function resolveCategory(schedule: CategoryScheduleConfig | undefined): string | undefined {
  if (!schedule) return undefined;
  const days: (keyof CategoryScheduleConfig)[] = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ];
  const today = days[new Date().getDay()];
  const categories = schedule[today];
  return categories?.[0]; // take first category for the day
}
```

### Pattern 3: Propagate notify flag through NightShiftTask

**What:** `NightShiftTask` currently lacks `notify` and `category` fields. The scheduler has access to `RecurringTaskConfig.notify` but does not copy it to the task. Add both fields to `NightShiftTask` and propagate them in `Scheduler.createTask()`.

**Why critical:** The orchestrator receives only `NightShiftTask` objects — it has no reference to the originating `RecurringTaskConfig`. Without propagating `notify`, the orchestrator cannot know whether to send notifications for a given task.

### Anti-Patterns to Avoid

- **Re-instantiating NtfyClient per notification call:** Instantiate once in `start()`, reuse throughout daemon lifetime. HTTP connection state and URL parsing happen once.
- **Blocking the poll loop on notification send:** `NtfyClient.send()` is already fire-and-forget with 5s timeout and catch-all. Call with `void` — do not `await` in the main path.
- **Checking `config.ntfy` inline in tick/handleCompleted:** This scatters the null-check. Centralise in the `notifyTaskStart` / `notifyTaskEnd` helpers.
- **Re-resolving category at notification send time:** Category must be resolved once at dispatch (scheduler), not at completion (orchestrator). Category represents "what category ran that night", not "what category is today when the task completed."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP notification delivery | Custom retry/queue | `NtfyClient.send()` with fire-and-forget | Already built with AbortSignal.timeout, catch-all, warn-on-failure |
| Day-of-week lookup | Custom date library | `new Date().getDay()` + static array index | No library needed; the mapping is a 7-element constant array |
| Priority encoding | String labels | ntfy numeric priority 1–5 | ntfy protocol uses integers; `NtfyMessage.priority` is already typed as `1|2|3|4|5` |

**Key insight:** Phase 2 is exclusively wiring — all building blocks exist. The risk is adding too much logic; the discipline is staying minimal.

## Common Pitfalls

### Pitfall 1: notify not propagated to NightShiftTask
**What goes wrong:** Orchestrator checks `task.notify` which is always `undefined` because the scheduler never copied it.
**Why it happens:** `NightShiftTask` was typed before the `notify` field existed in `RecurringTaskConfig`, and the scheduler's `createTask()` method pre-dates the notification feature.
**How to avoid:** Add `notify?: boolean` and `category?: string` to `NightShiftTask` type. Update `Scheduler.createTask()` to set both from `recurring.notify` and resolved category.
**Warning signs:** Unit tests for `notifyTaskStart` never fire even with `notify: true` in config.

### Pitfall 2: Category schedule arrays vs single string
**What goes wrong:** `CategoryScheduleConfig` maps days to `string[] | undefined` (arrays), not `string | undefined`. Taking `categories[0]` silently returns `undefined` if the array is empty.
**Why it happens:** The schema was designed for future multi-category support.
**How to avoid:** Guard the array lookup: `categories?.length ? categories[0] : undefined`. Log a warning if `code_agent.category_schedule` is set but today's day has no entry.
**Warning signs:** Category shows as `undefined` in notification body even when schedule is configured.

### Pitfall 3: Skipped tasks vs failed tasks treated identically
**What goes wrong:** NTFY-05 requires "skip" to have a distinct message from "failure" but `AgentExecutionResult.isError` is a single boolean — it does not distinguish timeout, crash, or skip.
**Why it happens:** Phase 3 defines the `NO_IMPROVEMENT` output convention; Phase 2 only knows `isError: boolean`.
**How to avoid:** For Phase 2, use `isError` as the only branch. The "skip" case (agent returns `NO_IMPROVEMENT`) is not distinguishable until Phase 3 parses agent output. Document this as a Phase 2 limitation. The success criterion says "distinct message that distinguishes it from a success notification" — this is met by different priority + title prefix even if skip/fail look similar to each other.
**Warning signs:** Trying to parse `result.result` for "NO_IMPROVEMENT" in Phase 2 — this couples Phase 2 to Phase 3 semantics prematurely.

### Pitfall 4: NtfyClient instantiated before config.ntfy is known
**What goes wrong:** If `NtfyClient` is created with `undefined` config, the constructor crashes on `config.baseUrl.replace(...)`.
**Why it happens:** `config.ntfy` is optional — daemon starts without it.
**How to avoid:** Guard instantiation: `this.ntfy = this.config.ntfy ? new NtfyClient(this.config.ntfy) : null;`. The helper methods check `if (!this.ntfy)` first.
**Warning signs:** TypeError at daemon start on systems without ntfy configured.

### Pitfall 5: Calling void on non-awaited promise in synchronous context
**What goes wrong:** `void this.ntfy.send(...)` inside a synchronous dispatch path is correct, but TypeScript's `@typescript-eslint/no-floating-promises` rule may flag it depending on project config.
**Why it happens:** `send()` returns `Promise<void>`.
**How to avoid:** Use `void` prefix explicitly. The existing codebase already uses this pattern (see `void this.writeHeartbeat()` in `pollLoop`). Consistent with established project style.

## Code Examples

Verified patterns from the existing codebase:

### Existing void-promise pattern in orchestrator (established style)
```typescript
// Source: src/daemon/orchestrator.ts line 64
this.heartbeatTimer = setInterval(
  () => void this.writeHeartbeat(),
  this.config.daemon.heartbeatIntervalMs,
);
```

### Existing NtfyClient.send signature (established interface)
```typescript
// Source: src/notifications/ntfy-client.ts
async send(message: NtfyMessage, logger: Logger): Promise<void>
// NtfyMessage priority type: 1 | 2 | 3 | 4 | 5
// priority 3 = default, 4 = high
```

### Existing dispatch point in orchestrator tick()
```typescript
// Source: src/daemon/orchestrator.ts lines 146-154
for (const task of readyTasks) {
  if (!this.pool.canAccept()) break;
  const claimed = await this.claimTask(task);
  if (claimed) {
    this.pool.dispatch(task);
    // INSERT: this.notifyTaskStart(task);
  }
}
```

### Existing completion point in handleCompleted()
```typescript
// Source: src/daemon/orchestrator.ts lines 226-270
private async handleCompleted(taskResult: TaskResult): Promise<void> {
  const { task, result, startedAt, completedAt } = taskResult;
  // ... report writing, bead closing, stats update ...
  // INSERT: this.notifyTaskEnd(task, result);  ← at the end
}
```

### Day-of-week resolution pattern
```typescript
// Node.js built-in — no library needed
const DAYS: (keyof CategoryScheduleConfig)[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];
const todayKey = DAYS[new Date().getDay()]; // getDay() returns 0=Sun, 6=Sat
const categories = config.codeAgent?.categorySchedule?.[todayKey];
const category = categories?.[0]; // first category wins; undefined if day not configured
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `NightShiftTask` without notify/category | `NightShiftTask` extended with `notify?: boolean` and `category?: string` | Phase 2 | Enables notification hooks throughout daemon without passing `RecurringTaskConfig` references downstream |

**Deprecated/outdated:**
- None — Phase 2 adds fields, does not change existing ones.

## Open Questions

1. **Should "skip" (NO_IMPROVEMENT) be visually distinct from "failure" in Phase 2 notifications?**
   - What we know: NTFY-05 says "distinct message" for failure OR skip. Phase 3 defines NO_IMPROVEMENT. Phase 2 only has `isError: boolean`.
   - What's unclear: Whether the planner should implement basic skip detection in Phase 2 by checking `result.result.includes("NO_IMPROVEMENT")`, or defer until Phase 3 adds structured output.
   - Recommendation: Defer to Phase 3. In Phase 2, failure = `isError: true`; success = everything else. Document that skip looks like success until Phase 3 runs. This avoids coupling.

2. **Does category injection into task context (CONF-03) mean only the notification body, or also the prompt?**
   - What we know: CONF-03 says "injects it into the task context". Phase 2 success criterion 4 says "daemon resolves today's category... and injects it into the task context". The prompt injection is explicitly covered by Phase 3 (AGENT-06: structured multi-step prompt).
   - What's unclear: Whether Phase 2 should inject category into the prompt string or just store it on the task for later use.
   - Recommendation: Phase 2 stores `category` on `NightShiftTask`. The orchestrator uses it in notification body text. Phase 3 injects it into the actual prompt. This division keeps Phase 2 self-contained.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | vitest.config.ts (or package.json scripts: `"test": "vitest run"`) |
| Quick run command | `npm test -- --reporter=verbose tests/unit/orchestrator.test.ts tests/unit/ntfy-client.test.ts` |
| Full suite command | `npm test` |
| Estimated runtime | ~5 seconds |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NTFY-03 | notifyTaskStart fires when task.notify=true and ntfy configured | unit | `npm test -- tests/unit/orchestrator.test.ts -t "notify"` | ❌ Wave 0 gap |
| NTFY-03 | notifyTaskStart does NOT fire when task.notify=false | unit | same | ❌ Wave 0 gap |
| NTFY-03 | notifyTaskStart does NOT fire when ntfy not configured | unit | same | ❌ Wave 0 gap |
| NTFY-04 | notifyTaskEnd fires with cost and summary on success | unit | `npm test -- tests/unit/orchestrator.test.ts -t "notify"` | ❌ Wave 0 gap |
| NTFY-04 | success notification uses priority 3 | unit | same | ❌ Wave 0 gap |
| NTFY-05 | notifyTaskEnd fires with priority 4 on failure | unit | same | ❌ Wave 0 gap |
| NTFY-05 | failure notification body contains error message | unit | same | ❌ Wave 0 gap |
| CONF-03 | resolveCategory returns correct value for each weekday | unit | `npm test -- tests/unit/scheduler.test.ts -t "category"` | ❌ Wave 0 gap |
| CONF-03 | resolveCategory returns undefined when day not in schedule | unit | same | ❌ Wave 0 gap |
| CONF-03 | task.category is set from resolved category in createTask | unit | same | ❌ Wave 0 gap |
| CONF-03 | task.notify is propagated from RecurringTaskConfig.notify | unit | same | ❌ Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm test -- tests/unit/orchestrator.test.ts tests/unit/scheduler.test.ts`
- **Full suite trigger:** Before merging the final task of Phase 2
- **Phase-complete gate:** Full suite green before verification
- **Estimated feedback latency per task:** ~3 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `tests/unit/orchestrator.test.ts` — extend existing file with notify hook tests (covers NTFY-03, NTFY-04, NTFY-05); mock `NtfyClient.send` via `vi.stubGlobal` or constructor injection
- [ ] `tests/unit/scheduler.test.ts` — extend existing file with category resolution and notify propagation tests (covers CONF-03)

*(Note: both test files already exist; they need new `describe` blocks added, not new files created)*

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/daemon/orchestrator.ts`, `src/daemon/scheduler.ts`, `src/notifications/ntfy-client.ts`, `src/core/types.ts`, `src/core/config.ts` — all read in full
- `tests/unit/orchestrator.test.ts`, `tests/unit/ntfy-client.test.ts`, `tests/unit/scheduler.test.ts` — read in full to understand existing test patterns
- `package.json` — confirmed Vitest 3.x, no additional dependencies needed

### Secondary (MEDIUM confidence)
- ntfy priority documentation (numeric 1–5 scale, 4=high) — consistent with `NtfyMessage` type already in codebase which uses `1 | 2 | 3 | 4 | 5`

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all existing code inspected directly
- Architecture: HIGH — insertion points identified by direct code reading, not inference
- Pitfalls: HIGH — identified from actual type gaps in the codebase (`notify` not on `NightShiftTask`, category array vs string)

**Research date:** 2026-02-24
**Valid until:** 2026-04-24 (stable codebase — confidence would only drop if types.ts or orchestrator.ts are significantly refactored)

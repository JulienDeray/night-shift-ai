# Phase 15: Notifications - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current minimal ntfy notifications with human-readable, agent-agnostic messages for every lifecycle event (start, success, failure). Remove agent-specific logic that leaked into the platform (NO_IMPROVEMENT fallback re-dispatch, fallback_categories config). The notification system should work identically for any agent — no hardcoded output parsing.

NTFY-04 (skip notification) is dropped — "skip" is not a platform concept. Only three notification types: start, success, failure.

</domain>

<decisions>
## Implementation Decisions

### Message content — moderate detail level
- Title uses agent name as prefix (not "Night-shift"): `code-agent done: nightly-refactor`
- Body includes: agent name, human-friendly duration (3m 42s), 1-line summary or error
- Start notification: title = `{agent} started: {task}`, body = `Agent: {agent}`
- Success notification: title = `{agent} done: {task}`, body = `{agent} • {duration}\n{first line of output}`
- Failure notification: title = `{agent} FAILED: {task}`, body = `{agent} • Step '{step}' failed\n{cleaned error message}`
- Priority: failures = 4 (high/urgent), start and success = 3 (default)
- Emoji tags via ntfy tags field: start, success, failure each get distinct emoji

### Output formatting
- Success: first line of finalOutput (string) or extract `summary`/`result` field if finalOutput is an object, fallback to JSON.stringify — truncated to 200 chars
- Failure: cleaned-up error message (strip stack traces, show message line only) + which step failed from perStep data
- Duration: human-friendly format — `3m 42s` for minutes+seconds, `1h 2m` for longer runs

### Agent-agnostic principle
- Drop NTFY-04 requirement entirely — no "skip" notification concept at the platform level
- Remove NO_IMPROVEMENT fallback re-dispatch logic from orchestrator
- Remove fallback_categories from agent config schema and nightshift.yaml
- Audit orchestrator during planning for any other agent-specific leaks (capture principle: orchestrator must be fully agent-agnostic)

### Architecture
- New separate formatter module builds NtfyMessage from task + AgentRunResult
- New NotificationService wraps formatter + NtfyClient — orchestrator calls `notificationService.taskStarted(task)` / `notificationService.taskCompleted(task, result)`
- NtfyClient stays as pure transport layer (send JSON to ntfy endpoint)
- Orchestrator's inline notifyTaskStart/notifyTaskEnd methods replaced by NotificationService calls

### Ntfy actions
- No action buttons on any notification type — keep it simple, no interactive elements
- NtfyAction interface can stay in NtfyClient for future use, but not wired into any notification

### Claude's Discretion
- Exact emoji tag choices per notification type
- NotificationService file location and naming
- Formatter implementation details (how to extract first line, how to clean errors)
- Whether to keep NtfyAction interface or remove unused code

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/notifications/ntfy-client.ts`: NtfyClient with send(NtfyMessage) — pure transport, stays as-is
- `src/agent/engine-types.ts`: AgentRunResult with perStep, failedStepIndex, totalDurationMs, stepOutputs — rich data for formatting
- NtfyMessage interface already supports title, body, priority, tags, actions

### Established Patterns
- Orchestrator creates NtfyClient in constructor if config.ntfy exists
- Fire-and-forget notifications (`void this.ntfy.send(...)`) — no await, failures logged as warnings
- `task.notify` boolean opt-in per task/recurring config

### Integration Points
- `src/daemon/orchestrator.ts:384-421`: notifyTaskStart and notifyTaskEnd — replace with NotificationService
- `src/daemon/orchestrator.ts:351-378`: NO_IMPROVEMENT fallback re-dispatch — remove entirely
- `src/core/config.ts`: fallback_categories in agent config schema — remove
- `src/core/types.ts`: NtfyConfig, notify field on task types — keep

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- Fallback category re-dispatch as agent-internal logic (if an agent wants retry-with-different-category, it handles it in its own pipeline steps, not the platform)
- Action buttons on notifications (e.g., "View MR") — kept for future if needed

</deferred>

---

*Phase: 15-notifications*
*Context gathered: 2026-03-13*

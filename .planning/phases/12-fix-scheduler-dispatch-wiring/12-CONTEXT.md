# Phase 12: Fix Scheduler Dispatch Wiring - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the `evaluateSchedules()` return value into `AgentPool.dispatch()` so scheduled agents actually execute. This is a gap closure fix — the scheduler correctly builds `NightShiftTask[]` but the orchestrator discards the return value on line 237.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- Capacity handling: follow existing patterns (check `pool.canAccept()` before dispatching, skip if full — next cron tick retries)
- Notification behavior: follow existing pattern (call `notifyTaskStart()` for dispatched scheduled tasks, same as manual dispatches)
- Dispatch ordering and error handling: consistent with existing poll-based dispatch at lines 246-257
- All technical decisions deferred to Claude — this is a straightforward wiring fix

</decisions>

<specifics>
## Specific Ideas

No specific requirements — follow established dispatch patterns in orchestrator.ts.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Scheduler.evaluateSchedules()` (src/daemon/scheduler.ts:37): Already returns `NightShiftTask[]` with proper `agentName`, `variables`, `notify` fields
- `AgentPool.dispatch()` (src/daemon/agent-pool.ts): Already routes `agentName` tasks to `AgentEngine`
- `notifyTaskStart()` (orchestrator.ts): Existing notification helper for dispatched tasks

### Established Patterns
- Poll-based dispatch (orchestrator.ts:246-257): `canAccept()` check, claim, dispatch, notify
- Fallback dispatch (orchestrator.ts:415): `canAccept()` guard before dispatch
- Scheduled tasks use `origin: "recurring"` and carry merged agent+schedule variables

### Integration Points
- orchestrator.ts line 237: The single line that needs to capture the return value
- The dispatch loop at lines 246-257: Pattern to replicate for scheduled tasks (minus `claimTask` since scheduled tasks don't come from a queue)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-fix-scheduler-dispatch-wiring*
*Context gathered: 2026-03-09*

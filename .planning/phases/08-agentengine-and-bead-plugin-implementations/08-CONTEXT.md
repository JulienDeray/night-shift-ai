# Phase 8: AgentEngine and Bead Plugin Implementations - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the generic `AgentEngine` that drives any agent directory's bead pipeline from its manifest, plus `StandardBeadPlugin` and `GitCloneBeadPlugin` as thin wrappers over existing `runBead()` and `cloneRepo()` functions. No agent-specific logic in the engine.

</domain>

<decisions>
## Implementation Decisions

### Pipeline failure handling
- Abort with rollback on any bead failure — stop the pipeline and undo side-effects (delete cloned repos, clean temp files)
- Categorize errors as FATAL or TRANSIENT using a fixed engine-level enum (not plugin-extensible)
- Engine does NOT retry transient errors — returns categorized error to caller, caller decides retry strategy
- Engine includes retry metadata in the result: which bead failed, error category, suggested delay, and restart-from bead index (prepares for future pipeline loopback)
- Clean slate rollback: everything cleaned up, no artifacts preserved from successful beads before the failure
- Bead timeouts are classified as FATAL
- Rollback failures are logged as warnings; the original bead error is always the returned error
- Per-bead timeouts only (from manifest) — no global pipeline timeout

### Dry-run mode
- Engine supports a dry-run mode that validates the pipeline without executing beads
- Dry-run checks: manifest valid, prompt files exist, plugins available, template variables all provided (every `{{variable}}` has a corresponding value in manifest or built-ins)
- Prepares for Phase 11's `agent validate` command

### Execution tracing & logging
- Per-bead structured log events: bead name, type, start time, duration, status, truncated input/output (first N characters)
- Structured run summary emitted at pipeline completion (success or failure): total duration, per-bead status, final outcome, error if any
- Engine generates a unique run ID per pipeline execution; all log entries include it for correlation
- No mid-execution events or EventEmitter pattern — logs only

### Temporary resource cleanup
- Single shared temp directory per run: `/tmp/nightshift-{runId}/` — all beads write there
- On success: temp directory deleted (including cloned repos)
- On failure + rollback: temp directory deleted (clean slate — no clone retained for debugging)
- On daemon start: scan and delete orphaned `nightshift-*` temp directories (from crashed runs)

### Engine result shape
- Rich generic `AgentRunResult<T>` where T is the final bead's output type — engine is truly generic, no agent-specific outcome types
- Result includes: runId, agent name, overall status (SUCCESS/FATAL/TRANSIENT), per-bead outcomes (name, status, duration, error), total duration, restart-from index if applicable
- Final bead's typed output included in the result (e.g., MR URL for code-agent) — caller can use it directly
- Per-bead outcomes include status + timing only, no I/O content (that's in the logs)
- Final result returned after completion — no real-time event streaming

### Claude's Discretion
- Run ID format (UUID, timestamp-based, etc.)
- Truncation length for I/O in structured logs
- Exact temp directory path convention
- Orphan cleanup age threshold
- Internal pipeline context accumulation between beads

</decisions>

<specifics>
## Specific Ideas

- Error categorization is forward-looking: the user envisions pipeline loopback where validation failures cycle back to implementation beads with additional feedback. Categorized errors + restart-from index are the foundation, even though loopback is a future phase.
- Dry-run mode with full variable checking bridges to Phase 11's `agent validate` CLI command.

</specifics>

<deferred>
## Deferred Ideas

- Pipeline loopback / cycle-back (validation fails → re-run implementation with feedback) — future phase, but error categories and restart-from index prepare for it
- EventEmitter / real-time progress events — not needed now, could be added for CLI progress display later

</deferred>

---

*Phase: 08-agentengine-and-bead-plugin-implementations*
*Context gathered: 2026-02-27*

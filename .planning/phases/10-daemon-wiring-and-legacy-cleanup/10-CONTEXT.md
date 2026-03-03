# Phase 10: Daemon Wiring and Legacy Cleanup - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Route all `agentName` tasks through `AgentEngine` in the daemon dispatch path, remove the hardcoded `code-agent.ts` and `code-agent-runner.ts`, delete `AgentRunner`, and clean up all legacy code-agent-specific types. After this phase, every task must specify an agent — the generic `AgentRunner` path is gone.

</domain>

<decisions>
## Implementation Decisions

### Dispatch routing
- Agent-only dispatch: every task must specify an `agentName`. Tasks without `agentName` are rejected (no generic `AgentRunner` fallback)
- `AgentPool.dispatch()` creates/uses `AgentEngine` to run manifest-driven agents. The pool owns the engine lifecycle
- `AgentRunner` is deleted entirely — all `claude -p` invocations go through `StandardBeadPlugin` inside the engine
- `agentName` stays optional on `NightShiftTask` type-wise (plain submits still queue, but dispatch rejects if no agent specified)

### Result bridging
- Orchestrator and AgentPool adopt `AgentRunResult` natively — no adapter layer
- `AgentExecutionResult` is deleted from `core/types.ts`
- `TaskResult` wraps `AgentRunResult` instead of `AgentExecutionResult`
- Notifications use the final bead output summary (e.g., MR URL for code-agent, truncated output string for others)
- Inbox reports show rich per-bead data: per-bead timing, status, and the final output

### Category fallback wiring
- Category fallback logic lives in the Orchestrator (not in the engine)
- Orchestrator calls `AgentEngine` per category. If result is `NO_IMPROVEMENT`, orchestrator dispatches a new task for the next fallback category
- Each fallback category attempt is a separate task in the pool, with its own inbox report and notification
- Fallback category order is per-agent in `nightshift.yaml` (e.g., `fallback_categories: [tests, refactoring, docs, security, performance]`). Agents without it skip fallback
- `Scheduler.evaluateSchedules()` is unwired from the Phase 7 `[]` stub — reads `config.schedule` entries, resolves cron, creates `NightShiftTask` with `agentName` and schedule-level variables

### Legacy cleanup
- Delete `code-agent.ts` and `code-agent-runner.ts` from `src/agent/`
- Delete `AgentRunner` from `src/daemon/agent-runner.ts`
- Delete `AgentExecutionResult` from `core/types.ts`
- Delete all code-agent-specific types: `CodeAgentConfig`, `CategoryScheduleConfig`, `PipelineContext`, `CodeAgentRunResult` from `src/agent/types.ts`
- JSONL run logger (`appendRunLog`) survives — moved to orchestrator as a post-run hook for every agent run (agent-agnostic)
- `nightshift run` CLI command is rewritten to use `AgentEngine` directly: `nightshift run --agent code-agent` runs in foreground, no daemon needed

### Claude's Discretion
- How AgentPool instantiates/caches AgentEngine instances (one per agent name, or fresh per run)
- Exact fallback task creation logic in orchestrator (naming, variable merging)
- How `nightshift submit` validates that `--agent` is provided (CLI-level error or pool-level rejection)
- JSONL log entry format adaptation for generic agents
- Cleanup of any remaining dead imports and unused utilities after deletion

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentEngine` (src/agent/engine.ts): Fully generic pipeline orchestrator — drives any agent directory through its bead pipeline
- `BeadRegistry` (src/agent/bead-registry.ts): Maps bead type strings to plugin factories — already wired
- `StandardBeadPlugin` (src/agent/plugins/standard-bead-plugin.ts): Wraps `runBead()` — replaces `AgentRunner` for claude -p calls
- `GitCloneBeadPlugin` (src/agent/plugins/git-clone-bead-plugin.ts): Wraps `cloneRepo()` — replaces the manual clone in `code-agent.ts`
- `TempDirManager` (src/agent/temp-dir-manager.ts): Shared temp directory per run — replaces manual cleanup in `code-agent.ts`
- `appendRunLog` (src/agent/run-logger.ts): JSONL logger — to be moved to orchestrator level
- `validateAgentsAtStartup` (src/daemon/orchestrator.ts): Already validates manifests at startup — no changes needed

### Established Patterns
- `AgentPool` manages concurrency via running Map + completedQueue drain pattern
- Orchestrator.tick() polls scheduler, collects completed, dispatches ready — same loop structure, just different dispatch target
- Config uses Zod schema with strict mode — new `fallback_categories` field needs schema update
- NtfyClient sends notifications via `this.ntfy.send()` — notification body format changes to use AgentRunResult

### Integration Points
- `AgentPool.dispatch()` — primary change site: replace AgentRunner with AgentEngine
- `Orchestrator.handleCompleted()` — adapt to AgentRunResult (report writing, bead closing, stats, notifications)
- `Orchestrator.tick()` — add fallback category re-dispatch logic after collecting completed tasks
- `Scheduler.evaluateSchedules()` — unwire the `[]` stub, implement schedule-to-task creation
- `src/cli/commands/run.ts` — rewrite to use AgentEngine directly
- `src/cli/commands/submit.ts` — require `--agent` flag
- Config schema (src/core/config.ts) — add `fallback_categories` to agent config schema

</code_context>

<specifics>
## Specific Ideas

- Each fallback category attempt should be a visible, separate task — not hidden inside a retry loop. This gives per-category inbox reports and notifications for full transparency
- `nightshift run` stays as the foreground testing command — it's the developer workflow for iterating on agent prompts without starting the daemon
- The JSONL log is a platform feature, not a code-agent feature — every agent gets a local log entry

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-daemon-wiring-and-legacy-cleanup*
*Context gathered: 2026-03-03*

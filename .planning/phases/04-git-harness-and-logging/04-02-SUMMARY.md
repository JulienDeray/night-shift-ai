---
phase: 04-git-harness-and-logging
plan: 02
subsystem: agent
tags: [harness, logging, mcp, confluence, cleanup, jsonl]

requires:
  - phase: 04-01
    provides: [cloneRepo, cleanupDir, appendRunLog, RunLogEntry, CloneResult, config schema with logMcpConfig]
  - phase: 03-02
    provides: [runCodeAgentPipeline, PipelineContext, runBead, buildBeadArgs, buildBeadEnv]
provides:
  - runCodeAgent top-level harness (clone -> pipeline -> JSONL -> Confluence log bead -> cleanup)
  - Log bead prompt template for Confluence table update via MCP Atlassian
  - Extended bead-runner supporting "log" bead name, mcpConfigPath, custom allowedTools
  - deriveSummary utility for converting pipeline outcomes to summary strings
affects: [entry-points, daemon, orchestrator]

tech-stack:
  added: []
  patterns: [best-effort bead pattern, unconditional finally cleanup, MCP tool isolation for log bead]

key-files:
  created:
    - src/agent/code-agent.ts
    - src/agent/prompts/log.md
    - tests/unit/code-agent.test.ts
  modified:
    - src/agent/bead-runner.ts

key-decisions:
  - "Log bead failure is caught and logged but does not propagate — best-effort Confluence update never masks pipeline result"
  - "Log bead does not receive GITLAB_TOKEN — only HOME and PATH are in its env (security isolation)"
  - "deriveSummary exported (not private) for testability and potential reuse by callers"
  - "LOG_BEAD_TIMEOUT_MS fixed at 120s — Confluence MCP calls are fast, long timeout indicates failure"
  - "result parameter passed to runLogBead for future extensibility despite not currently being used"

patterns-established:
  - "Best-effort bead pattern: wrap in try/catch, log error, do not rethrow — preserves pipeline result"
  - "Unconditional finally cleanup: both temp dirs always deleted regardless of success or failure"
  - "MCP tool isolation: log bead receives exactly the 3 Atlassian tools it needs, no Bash/Read/Write"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03, AGENT-04, LOG-01, LOG-02]

duration: 3min
completed: 2026-02-25
---

# Phase 04 Plan 02: runCodeAgent Harness Summary

**Top-level `runCodeAgent` harness wiring clone -> 4-bead pipeline -> JSONL logging -> Confluence MCP log bead -> unconditional cleanup, completing the full Phase 4 lifecycle.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-25T14:38:04Z
- **Completed:** 2026-02-25T14:41:46Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 1 created in prompts/, 1 modified)

## Accomplishments

- Created `runCodeAgent` as the single callable function that owns the full agent lifecycle
- Extended `bead-runner.ts` to support the "log" bead name, `mcpConfigPath`, and custom `allowedTools`
- Created `prompts/log.md` with Confluence page update instructions (newest-first row insertion, content preservation)
- 21 unit tests covering all lifecycle scenarios including cleanup on crash, best-effort error handling, token isolation, and all outcome types

## Task Commits

1. **Task 1: Log bead prompt + extend bead-runner for MCP support** - `67bc528` (feat)
2. **Task 2: Top-level runCodeAgent harness with tests** - `8a72359` (feat)

## Files Created/Modified

- `src/agent/code-agent.ts` - Top-level harness: clone -> pipeline -> JSONL log -> log bead -> cleanup
- `src/agent/prompts/log.md` - Log bead prompt template for Confluence table update via MCP Atlassian
- `src/agent/bead-runner.ts` - Extended to support "log" bead, mcpConfigPath, and custom allowedTools
- `tests/unit/code-agent.test.ts` - 21 unit tests for full harness lifecycle

## Decisions Made

- **Log bead failure is best-effort**: `runBead` for log is wrapped in try/catch; error is logged but pipeline result is always returned. The Confluence update is useful for observability but never critical.
- **Log bead receives no GITLAB_TOKEN**: Security isolation — the log bead uses MCP Atlassian tools that authenticate independently. Explicitly excluded from `buildBeadEnv` for "log" beadName.
- **`deriveSummary` exported**: Made public for testability. Tests can assert specific summary strings for each outcome type without mocking date-sensitive logic.
- **`LOG_BEAD_TIMEOUT_MS` fixed at 120s**: Confluence MCP calls are fast (~2-5s for get+update). A 2-minute timeout allows for slow API responses while reliably catching hung calls.
- **`result` passed to `runLogBead`**: The `CodeAgentRunResult` is passed through even though `runLogBead` doesn't currently use it directly — all needed fields are in `logEntry`. This preserves the function signature for future extensibility (e.g., including outcome-specific behavior).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

Phase 4 is now complete. All requirements are satisfied:
- **AGENT-01**: `cloneRepo` with shallow clone and token support (Plan 01)
- **AGENT-02**: Unconditional cleanup via `finally` block (this plan)
- **AGENT-03**: `runCodeAgentPipeline` with 4-bead orchestration (Phase 03)
- **AGENT-04**: `runCodeAgent` top-level harness (this plan)
- **LOG-01**: JSONL append log at `.nightshift/logs/code-agent-runs.jsonl` (Plan 01)
- **LOG-02**: Confluence log bead via MCP Atlassian with `--mcp-config` (this plan)

The system is ready for integration: wire `runCodeAgent` into the daemon's recurring task handler or a standalone CLI entry point.

---
*Phase: 04-git-harness-and-logging*
*Completed: 2026-02-25*

## Self-Check

### Created files exist

- `src/agent/code-agent.ts`: present
- `src/agent/prompts/log.md`: present
- `tests/unit/code-agent.test.ts`: present
- `src/agent/bead-runner.ts` (modified): present

### Commits exist

- 67bc528: feat(04-02): add log bead prompt and extend bead-runner for MCP support
- 8a72359: feat(04-02): create runCodeAgent harness with log bead and full lifecycle tests

## Self-Check: PASSED

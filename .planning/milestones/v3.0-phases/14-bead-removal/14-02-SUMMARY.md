---
phase: 14-bead-removal
plan: 02
subsystem: agent
tags: [engine, pipeline, refactor, cleanup]

requires:
  - phase: 14-01
    provides: Renamed types (StepOutcome, AgentRunResult.perStep, StepContractViolationError, StepOutputMissingError, validateStepOutput, ResolvedStep, LoadedManifest.steps)

provides:
  - AgentEngine with inline step execution (reads prompt, renders, calls runStep, validates output)
  - Simplified AgentPool creating AgentEngine directly with no registry
  - Orchestrator with file-queue only (no BeadsClient, no beads branches)
  - CLI commands using file-queue only with no bead/BeadsClient references

affects: [14-03, agent-execution, daemon-orchestration]

tech-stack:
  added: []
  patterns:
    - "Inline step execution: engine.ts owns all step logic directly, no plugin dispatch"
    - "File-queue only: orchestrator polls queue dir, no external task tracker"

key-files:
  created: []
  modified:
    - src/agent/engine.ts
    - src/daemon/agent-pool.ts
    - src/daemon/orchestrator.ts
    - src/inbox/reporter.ts
    - src/cli/commands/submit.ts
    - src/cli/commands/cancel.ts
    - src/cli/commands/status.ts
    - src/cli/commands/_run-agent.ts
    - src/cli/commands/agent.ts
    - src/agent/scaffold.ts

key-decisions:
  - "AgentEngine constructor takes only logger — no registry parameter"
  - "Inline step execution replaces plugin dispatch: read prompt, render, runStep, validate all in engine.ts"
  - "Orchestrator polling uses getQueuedTasks() only — beads branches fully removed"
  - "scaffold.ts updated to generate steps (not beads) without type field"

patterns-established:
  - "No plugin indirection: AgentEngine.run() executes steps directly via runStep()"
  - "Single task persistence mechanism: file-queue in .nightshift/queue/"

requirements-completed: [BEAD-01, BEAD-02]

duration: 7min
completed: 2026-03-13
---

# Phase 14 Plan 02: Inline Step Execution and BeadsClient Removal Summary

**AgentEngine now executes steps inline via runStep() with no plugin/registry indirection; src/beads/ and all plugin files deleted; orchestrator and CLI commands use file-queue exclusively**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-13T13:47:16Z
- **Completed:** 2026-03-13T13:54:21Z
- **Tasks:** 2
- **Files modified:** 10 modified, 8 deleted

## Accomplishments
- AgentEngine rewritten to inline step execution: reads prompt file, renders template, calls runStep(), validates output — all without plugin dispatch
- Deleted 8 files: bead-plugin.ts, bead-registry.ts, standard-bead-plugin.ts, git-clone-bead-plugin.ts, git-harness.ts, src/beads/client.ts, types.ts, mapper.ts
- Orchestrator simplified: removed BeadsClient field, all beads branches from getReadyTasks/claimTask/handleCompleted; only file-queue remains
- All CLI commands (submit, cancel, status, _run-agent, agent) fully cleaned of BeadsClient/BeadRegistry references

## Task Commits

Each task was committed atomically:

1. **Task 1: Inline step execution into AgentEngine and delete plugin system** - `105c4ee` (feat)
2. **Task 2: Remove BeadsClient, update orchestrator and CLI commands** - `4849d91` (feat)

## Files Created/Modified
- `src/agent/engine.ts` - Rewritten with inline step execution, constructor takes logger only
- `src/daemon/agent-pool.ts` - Simplified, creates AgentEngine directly with no registry
- `src/daemon/orchestrator.ts` - Removed BeadsClient, beads field, and all beads branches
- `src/inbox/reporter.ts` - Renamed perBead->perStep, bead_count->step_count, section headers
- `src/cli/commands/submit.ts` - Removed BeadsClient branch, file-queue only
- `src/cli/commands/cancel.ts` - Removed BeadsClient branch, file-queue only
- `src/cli/commands/status.ts` - Removed BeadsClient branch and "(beads not available)" message
- `src/cli/commands/_run-agent.ts` - Removed registry setup, creates AgentEngine directly
- `src/cli/commands/agent.ts` - Renamed bead->step throughout validate/list/show subcommands
- `src/agent/scaffold.ts` - Updated generated manifest to use steps instead of beads

## Decisions Made
- Inline step execution (not a separate helper function) keeps engine.ts self-contained
- scaffold.ts scaffold template updated from beads/type to steps (no type field) as part of this cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated scaffold.ts bead->step terminology**
- **Found during:** Task 2 verification (grep for bead references)
- **Issue:** scaffold.ts was generating manifests with `beads:` key and `type: git-clone`/`type: standard` fields — the old schema that no longer exists
- **Fix:** Updated generated manifest to use `steps:` with no type field; removed git-clone step (GitCloneBeadPlugin deleted); simplified to single analyze step
- **Files modified:** src/agent/scaffold.ts
- **Verification:** No bead terminology in production source files
- **Committed in:** 4849d91 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Necessary correctness fix — scaffold would have generated invalid manifests without this.

## Issues Encountered
None — TypeScript compiled cleanly with zero errors after both tasks.

## Next Phase Readiness
- Plan 02 complete: plugin system and BeadsClient fully removed
- Plan 03 (test cleanup) can proceed: update test files that still reference old bead terminology
- No blockers

---
*Phase: 14-bead-removal*
*Completed: 2026-03-13*

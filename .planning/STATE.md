---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Pluggable Agent Architecture
status: in_progress
last_updated: "2026-02-25"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 21
  completed_plans: 1
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.
**Current focus:** Phase 5 — Dispatch Foundation

## Current Position

Phase: 5 of 11 (Dispatch Foundation) — first v2.0 phase
Plan: 1 of 3 complete
Status: In progress
Last activity: 2026-02-25 — completed 05-01 (agent-types.ts + agentName dispatch migration)

Progress: [█░░░░░░░░░] ~5% (v2.0, 1/21 plans complete)

## Performance Metrics

**Velocity (v1.0 baseline):**
- Total plans completed: 8 (v1.0)
- Average duration: ~30 min
- Total execution time: ~4 hours

**By Phase (v1.0):**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Notification Foundation | 2 | Complete |
| 2. Orchestrator Hooks | 2 | Complete |
| 3. Agent Prompt and Security | 2 | Complete |
| 4. Git Harness and Logging | 2 | Complete |

*v2.0 metrics will populate as plans complete*

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table.

Key v2.0 design decisions locked in research:
- `isCodeAgent` retired in Phase 5 before any new agent type is added
- Manifest schema (Phase 6) must be locked before engine (Phase 8) is written
- Config migration uses expand-and-contract: both `code_agent:` and `agents:` accepted simultaneously
- `AgentEngine` must be generic — zero code-agent-specific logic in the engine

Phase 5 Plan 01 decisions (2026-02-25):
- `agentName` optional on NightShiftTask until Phase 10 migration makes it required
- AgentRunResult import kept live in agent-pool.ts via private field until Phase 10
- validateAgentName regex handles single-char and multi-char kebab names separately (no trailing hyphens)

### Pending Todos

None.

### Blockers/Concerns

Carried from v1.0 (need empirical validation):
- Skip criteria thresholds in bead prompts need tuning after first real runs
- GIT_CONFIG_NOSYSTEM=1 credential blocking needs integration test
- Confluence macro-stripping workaround needs validation against real instance

Research flags for planning (investigate before finalizing plans):
- Phase 6: `BeadPlugin<TInput, TOutput>` generic design — read both plugin implementations before finalizing interface
- Phase 9: Category rotation in manifest — read `resolveCategory()` in `scheduler.ts` before designing manifest representation

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Wire runCodeAgent into daemon | 2026-02-25 | 3e5b733 | [1-wire-runcodeagent-into-daemon](./quick/1-wire-runcodeagent-into-daemon/) |
| 2 | Implement nightshift run command | 2026-02-25 | acad107 | [2-implement-a-nightshift-command-to-run-a-](./quick/2-implement-a-nightshift-command-to-run-a-/) |
| 3 | Load GitLab token from .env file | 2026-02-25 | 9fafd83 | [3-load-gitlab-token-from-env-file-if-avail](./quick/3-load-gitlab-token-from-env-file-if-avail/) |
| 4 | Fix false-positive MR_CREATED outcome when MR bead fails | 2026-02-25 | 6286003 | [4-investigate-why-mr-was-not-created-despi](./quick/4-investigate-why-mr-was-not-created-despi/) |

## Session Continuity

Last session: 2026-02-25
Stopped at: Completed 05-01-PLAN.md (agent-types + agentName dispatch migration)
Resume file: None

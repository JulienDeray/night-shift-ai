---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Pluggable Agent Architecture
status: unknown
last_updated: "2026-02-26T15:26:37Z"
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.
**Current focus:** Phase 6 — Plugin Interfaces and Manifest Schema

## Current Position

Phase: 6 of 11 (Plugin Interfaces and Manifest Schema)
Plan: 3 of 3 complete
Status: In progress
Last activity: 2026-02-26 — completed 06-03 (agent template variable system: dot notation, array indexing, built-in precedence, load-time validation)

Progress: [█░░░░░░░░░] ~24% (v2.0, 5/21 plans complete)

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

Phase 5 Plan 02 decisions (2026-02-25):
- Single handoff file per run with structured keys (analysis, verify) — not one file per bead
- handoffPath() helper centralizes filename construction: handoff-code-agent-{taskId}.json
- Verify bead pre-reads existing file before writing stub to preserve analysis key
- runAnalyzeBead rewrites handoff file as { analysis: <result> } after parsing agent output

Phase 6 Plan 01 decisions (2026-02-26):
- KNOWN_CLAUDE_TOOLS list hardcoded in manifest-schema.ts — unknown tools rejected at schema parse time
- BeadRegistry is a DI instance (not singleton) — passed to engine constructor, allows clean testing
- AgentPipelineContext named explicitly to avoid shadowing two existing PipelineContext types in codebase
- BeadPlugin.execute() single-method interface — no lifecycle hooks per locked CONTEXT.md decision

Phase 6 Plan 03 decisions (2026-02-26):
- src/utils/template.ts left entirely unchanged — no import relationship between old and new modules
- resolveNestedValue normalises [N] bracket syntax to .N before splitting on dots
- renderAgentTemplate leaves unknown placeholders as-is; validateTemplateVars does the hard error at load time
- beads.* variables skipped at load-time validation — those paths only exist at pipeline runtime

### Pending Todos

None.

### Blockers/Concerns

Carried from v1.0 (need empirical validation):
- Skip criteria thresholds in bead prompts need tuning after first real runs
- GIT_CONFIG_NOSYSTEM=1 credential blocking needs integration test
- Confluence macro-stripping workaround needs validation against real instance

Research flags for planning (investigate before finalizing plans):
- Phase 9: Category rotation in manifest — read `resolveCategory()` in `scheduler.ts` before designing manifest representation

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Wire runCodeAgent into daemon | 2026-02-25 | 3e5b733 | [1-wire-runcodeagent-into-daemon](./quick/1-wire-runcodeagent-into-daemon/) |
| 2 | Implement nightshift run command | 2026-02-25 | acad107 | [2-implement-a-nightshift-command-to-run-a-](./quick/2-implement-a-nightshift-command-to-run-a-/) |
| 3 | Load GitLab token from .env file | 2026-02-25 | 9fafd83 | [3-load-gitlab-token-from-env-file-if-avail](./quick/3-load-gitlab-token-from-env-file-if-avail/) |
| 4 | Fix false-positive MR_CREATED outcome when MR bead fails | 2026-02-25 | 6286003 | [4-investigate-why-mr-was-not-created-despi](./quick/4-investigate-why-mr-was-not-created-despi/) |

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 06-03-PLAN.md (agent template variable system)
Resume file: None

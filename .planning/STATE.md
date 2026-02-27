---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Pluggable Agent Architecture
status: unknown
last_updated: "2026-02-26T16:39:33.092Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 7
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.
**Current focus:** Phase 8 — AgentEngine and Bead Plugin Implementations

## Current Position

Phase: 8 of 11 (AgentEngine and Bead Plugin Implementations)
Plan: 0/? — context gathered, ready for planning
Status: In progress
Last activity: 2026-02-27 — Phase 8 context gathered

Progress: [█░░░░░░░░░] ~33% (v2.0, 7/21 plans complete)

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
| Phase 07 P02 | 2 | 2 tasks | 2 files |

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

Phase 6 Plan 02 decisions (2026-02-26):
- z.fromJSONSchema() used directly without (z as any) cast — confirmed exported from zod v4 TypeScript types
- extractLastJsonBlock regex matches both ```json and ``` (no language tag) blocks
- assertContained() exported for runtime engine use in Phase 8 (path containment at both load and run time)

Phase 6 Plan 03 decisions (2026-02-26):
- src/utils/template.ts left entirely unchanged — no import relationship between old and new modules
- resolveNestedValue normalises [N] bracket syntax to .N before splitting on dots
- renderAgentTemplate leaves unknown placeholders as-is; validateTemplateVars does the hard error at load time
- beads.* variables skipped at load-time validation — those paths only exist at pipeline runtime

Phase 7 Plan 01 decisions (2026-02-26):
- CodeAgentConfig and CategoryScheduleConfig moved to src/agent/types.ts (not deleted) — code-agent pipeline still compiles
- resolveCategory() moved inline to code-agent-runner.ts — removed from scheduler since scheduler no longer iterates recurring tasks
- scheduler.evaluateSchedules() returns [] stub — Phase 10 will wire the new schedule format
- Config migration uses hard break (.strict()) not expand-and-contract — old code_agent:/recurring: keys immediately rejected

Phase 7 Plan 02 decisions (2026-02-26):
- validateAgentsAtStartup placed before heartbeat timer and before "Daemon started" log in start() — failure exits before any daemon logging
- Built-in placeholder values injected as "<task_id>" strings so validateTemplateVars sees them as defined (not undefined)
- Prompt file reads use real fs.readFile() in implementation; tests mock only loadManifest and use real tmpdir files
- [Phase 07-02]: validateAgentsAtStartup placed before heartbeat timer and before 'Daemon started' log in start() — failure exits before any daemon logging
- [Phase 07-02]: Built-in placeholder values injected as '<task_id>' strings so validateTemplateVars sees them as defined (not undefined)
- [Phase 07-02]: Prompt file reads use real fs.readFile() in implementation; tests mock only loadManifest and use real tmpdir files

### Pending Todos

None.

### Blockers/Concerns

Carried from v1.0 (need empirical validation):
- Skip criteria thresholds in bead prompts need tuning after first real runs
- GIT_CONFIG_NOSYSTEM=1 credential blocking needs integration test
- Confluence macro-stripping workaround needs validation against real instance

Research flags for planning (investigate before finalizing plans):
- Phase 9: Category rotation in manifest — resolveCategory() is now in src/agent/code-agent-runner.ts (moved from scheduler.ts in Phase 7)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Wire runCodeAgent into daemon | 2026-02-25 | 3e5b733 | [1-wire-runcodeagent-into-daemon](./quick/1-wire-runcodeagent-into-daemon/) |
| 2 | Implement nightshift run command | 2026-02-25 | acad107 | [2-implement-a-nightshift-command-to-run-a-](./quick/2-implement-a-nightshift-command-to-run-a-/) |
| 3 | Load GitLab token from .env file | 2026-02-25 | 9fafd83 | [3-load-gitlab-token-from-env-file-if-avail](./quick/3-load-gitlab-token-from-env-file-if-avail/) |
| 4 | Fix false-positive MR_CREATED outcome when MR bead fails | 2026-02-25 | 6286003 | [4-investigate-why-mr-was-not-created-despi](./quick/4-investigate-why-mr-was-not-created-despi/) |

## Session Continuity

Last session: 2026-02-27
Stopped at: Phase 8 context gathered
Resume file: .planning/phases/08-agentengine-and-bead-plugin-implementations/08-CONTEXT.md

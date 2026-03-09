---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Pluggable Agent Architecture
status: completed
stopped_at: Phase 12 context gathered
last_updated: "2026-03-09T20:04:49.976Z"
last_activity: 2026-03-09 — Phase 11 Plan 02 complete (all v2.0 plans done)
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 17
  completed_plans: 17
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.
**Current focus:** Phase 9 — Code-Agent Migration

## Current Position

Phase: 11 of 11 (Developer Experience)
Plan: 3/3 — All plans complete
Status: Complete
Last activity: 2026-03-09 — Phase 11 Plan 02 complete (all v2.0 plans done)

Progress: [██████████] 100% (v2.0, 17/17 plans complete)

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
| Phase 08 P01 | 261 | 2 tasks | 9 files |
| Phase 08 P02 | 4 | 2 tasks | 2 files |
| Phase 09 P01 | 20 | 2 tasks | 9 files |
| Phase 09 P02 | 6 | 2 tasks | 10 files |
| Phase 10 P01 | 5 | 2 tasks | 10 files |
| Phase 10 P02 | 25 | 2 tasks | 14 files |
| Phase 10 P03 | 5 | 1 tasks | 3 files |
| Phase 11 P01 | 3 | 2 tasks | 3 files |
| Phase 11 P02 | 4 | 2 tasks | 2 files |
| Phase 11 P03 | 1492 | 2 tasks | 2 files |

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
- [Phase 08]: GITLAB_TOKEN gating changed from beadName==='mr' to gitlabToken presence — removes code-agent-specific logic from shared bead-runner infrastructure
- [Phase 08]: cloneRepo() optional repoDir: on clone failure with caller-provided dir, only handoffDir is cleaned (caller owns repoDir lifecycle)

Phase 8 Plan 02 decisions (2026-02-27):
- categorizeError() checks timedOut flag first — timeout errors are FATAL even if error class would otherwise be TRANSIENT
- Manifest load failure creates temp dir first then cleans up — temp dir always exists to clean regardless of failure point
- dryRun() uses placeholder built-in strings ('<task_id>') so validateTemplateVars sees them as defined (same pattern as Phase 7 startup-validation)
- ctx reconstructed with spread per bead iteration — immutable update pattern avoids shared reference bugs
- [Phase 09]: mcpConfig stored as raw string on ResolvedBead (deferred resolution) — template variables rendered at plugin execution time via renderAgentTemplate before path.join
- [Phase 09]: retryCount not reset between beads — persists across entire run to enforce maxAttempts cap correctly for implement→verify retry loops
- [Phase 09]: mcp__* prefix accepted in allowedTools via !t.startsWith('mcp__') filter — error message updated to mention 'or any mcp__* tool'
- [Phase 09]: retry_error declared in manifest variables with empty string default so dryRun validates implement.md without error — engine overwrites with actual error details on retry
- [Phase 09]: GitCloneBeadPlugin rawOutput wrapped in JSON code block format — required because validateBeadOutput uses extractLastJsonBlock which only matches code block syntax
- [Phase 10]: AgentEngine + BeadRegistry created fresh per dispatch (not stored per-task — engine is stateless)
- [Phase 10]: Tasks without agentName push FATAL AgentRunResult synchronously to completedQueue (no async rejection)
- [Phase 10]: totalCostUsd kept on DaemonState at zero — AgentRunResult has no cost tracking
- [Phase 10]: Fallback dispatch only when pool.canAccept() — no queueing if pool is full
- [Phase 10 P02]: BeadResult and ClaudeJsonOutput inlined into bead-runner.ts after types.ts deleted — avoids creating a new shared file
- [Phase 10 P02]: Schedule state key uses agent:cron format to avoid collisions with v1.0 task-name keys
- [Phase 10 P02]: nightshift run drops --timeout/--budget/--model/--tools options — engine reads from manifest
- [Phase 10 P02]: nightshift submit --agent now required; prompt becomes optional positional argument
- [Phase 10]: Flaky full-suite parallel runs are pre-existing race conditions (ENOENT on tmpdir); --pool=forks --singleFork confirms 384/384 pass
- [Phase 10]: [Phase 10 P03]: schedule.test.ts third test replaced: obsolete timeout-inheritance concept removed, replaced with enabled/disabled entry assertion

Phase 11 Plan 01 decisions (2026-03-09):
- [Phase 11-01]: Two-pass validate: ManifestSchema.safeParse for schema, loadManifest for env vars (env missing = warning not error)
- [Phase 11-01]: scaffold uses parseYaml for raw config editing to avoid Zod schema enforcement on nightshift.yaml write-back
- [Phase 11-01]: agent list and show use parseYaml (not loadManifest) to avoid env var errors when inspecting agents
- [Phase 11]: [Phase 11-03]: README kept concise with link to docs/agents.md for detailed agent reference
- [Phase 11]: [Phase 11-03]: docs/agents.md structured around code-agent as annotated example, documenting all manifest fields with types/defaults from source

Phase 11 Plan 02 decisions (2026-03-09):
- [Phase 11-02]: TDD tests written against existing implementation -- validates scaffold output and CLI behavior
- [Phase 11-02]: Integration tests use spawnWithTimeout pattern consistent with existing init-and-config.test.ts

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

Last session: 2026-03-09T20:04:49.974Z
Stopped at: Phase 12 context gathered
Resume file: .planning/phases/12-fix-scheduler-dispatch-wiring/12-CONTEXT.md

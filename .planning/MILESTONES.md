# Milestones

## v3.0 Consolidation (Shipped: 2026-03-16)

**Phases completed:** 4 phases (14-17), 12 plans
**Timeline:** 25 days (2026-02-19 to 2026-03-16)
**Git range:** feat(14-01) to docs(v3.0) (60 commits)
**LOC:** 4,793 TypeScript (132 files changed, +8,875 / -3,983)

**Key accomplishments:**
1. Eliminated bead abstraction — BeadPlugin/BeadRegistry/BeadRunner deleted, AgentEngine executes steps inline with no intermediary layer
2. Human-readable notifications — NotificationService with pure-function formatters for start/success/failure events, wired into orchestrator
3. Collapsed 8-class error hierarchy into single NightShiftError with NightShiftErrorCode union and code-based discrimination
4. Full E2E test harness — 16 tests covering daemon lifecycle, CLI commands, error scenarios, and mocked externals (Claude CLI, GitLab, ntfy)
5. Removed dead code — v1.0 prompt files, prompt-loader.ts, stale exports, legacy compatibility remnants
6. Codebase consolidated to cleanest, most testable state — 4,793 LOC TypeScript

**Delivered:** The platform stripped of all v1/v2 abstraction debt — bead layer removed, errors unified, dead code eliminated, and a full E2E test harness proving the daemon lifecycle, agent execution, CLI commands, and error scenarios all work end-to-end with zero real network calls.

### Known Tech Debt
- Integration test flakiness (7-8 tests under parallel execution) — pre-existing OS temp directory collisions
- `_run-agent.ts` CLI foreground runner uses old inline ntfy pattern instead of NotificationService — pre-existing
- NTFY-04 (skip notification) explicitly dropped by user decision — no skip concept at platform level
- Orphaned `maxTokens` parameter in `step-runner.ts` — naming mismatch vestige
- Scheduled-task notification path not covered by E2E tests (only unit tests)
- Human verification pending: `npm run test:e2e` (16 tests) needs manual execution

---

## v2.0 Pluggable Agent Architecture (Shipped: 2026-03-09)

**Phases completed:** 9 phases (5-13), 19 plans
**Timeline:** 13 days (2026-02-25 to 2026-03-09)
**Git range:** feat(05-01) to docs(phase-13) (101 commits)
**LOC:** 12,752 TypeScript (138 files changed, +23,824 / -4,414)

**Key accomplishments:**
1. Pluggable agent architecture with directory-based agents and manifest-driven configuration
2. Generic AgentEngine executing any agent's bead pipeline with typed plugins and error categorization
3. Code-agent fully migrated from hardcoded pipeline to configured agent template — zero functionality loss
4. Config schema rewritten for multi-agent scheduling with startup validation
5. Developer experience CLI: agent init, validate, list, show with 21 tests
6. Full legacy cleanup: all hardcoded code-agent code removed, single dispatch path

**Delivered:** A configurable agent platform where agents are directories (prompt files + manifest.yaml), beads are composable plugins with typed inputs/outputs, and code-agent is one configured template among many — with CLI tooling for scaffolding, validation, and inspection.

### Known Tech Debt
- 4 orphaned type stubs in `src/agent/agent-types.ts` (cosmetic)
- SUMMARY frontmatter gaps in plans 06-02, 08-01 (metadata only)
- Stale doc comments referencing deleted files in Phase 10 code (cosmetic)

---

## v1.0 MVP (Shipped: 2026-02-25)

**Phases completed:** 4 phases, 8 plans, 16 tasks
**Timeline:** 3 days (2026-02-23 to 2026-02-25)
**Git range:** feat(01-01) to feat(04-02) (42 commits)
**LOC:** 9,068 TypeScript (55 files changed, 9,570 insertions)

**Key accomplishments:**
1. Ntfy push notification platform with fire-and-forget HTTP POST, per-task opt-in, and priority-based failure escalation
2. Config-driven day-of-week category rotation with strict Zod validation, resolved at task dispatch time
3. Injection-mitigated 4-bead prompt system (analyze/implement/verify/mr) with hardcoded security preamble
4. Secure code-agent pipeline with category fallback, implement retry, and GITLAB_TOKEN isolation
5. Git clone lifecycle with unconditional cleanup, GIT_CONFIG_NOSYSTEM isolation, and SSH_AUTH_SOCK forwarding
6. Dual logging: JSONL local log + Confluence page update via MCP Atlassian log bead

**Delivered:** A nightly code improvement agent that clones a GitLab repo, finds one focused improvement per category rotation, creates a merge request, and logs results to both local JSONL and Confluence — with push notifications for the full lifecycle.

---


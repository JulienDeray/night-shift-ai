# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Small, focused merge requests that appear in the morning — one coherent improvement per night, easy to review, never overwhelming.
**Current focus:** Phase 3 — Agent Prompt and Security (in progress)

## Current Position

Phase: 3 of 4 (Agent Prompt and Security) — IN PROGRESS
Plan: 1 of 2 in current phase — COMPLETE
Status: Plan 03-01 complete, ready for Plan 03-02
Last activity: 2026-02-25 — Plan 03-01 completed

Progress: [█████░░░░░] 50%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 1.5 min
- Total execution time: 0.10 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-notification-foundation | 2 | 3 min | 1.5 min |
| 02-orchestrator-hooks | 2 | 3 min | 1.5 min |
| 03-agent-prompt-and-security | 1 | 4 min | 4 min |

**Recent Trend:**
- Last 5 plans: 01-01 (2 min), 01-02 (1 min), 02-01 (1 min), 02-02 (2 min), 03-01 (4 min)
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- All phases: Zero new npm dependencies — native fetch covers Ntfy, existing spawnWithTimeout covers git/glab
- Phase 1: Ntfy as platform feature (not prompt-baked) for reuse across all recurring tasks
- Phase 4: Fresh clone per run — avoids stale state and credential accumulation
- 01-01: Use z.object().strict() for CategoryScheduleSchema (not z.record(z.enum())) — Zod v4 record with enum requires all keys present
- 01-01: confluence_page_id is required (not optional) per user constraints
- 01-01: NtfyConfigSchema and CodeAgentSchema use .optional() so daemon starts without either block
- 01-02: Use AbortSignal.timeout(5000) — no manual AbortController needed, Node 22 supports it natively
- 01-02: NtfyMessage.body maps to JSON field "message" — property named body for clarity, wire format uses ntfy convention
- 01-02: No module-level fetch import — Node 22 provides fetch as a global, consistent with zero new dependencies decision
- 02-01: resolveCategory exported (not private) so tests can import it directly and future phases can reuse it
- 02-01: Category resolved at task creation time (dispatch), not at completion time — frozen semantics prevent category drift
- 02-01: DAYS array is module-level constant, not re-created per call
- [Phase 02-orchestrator-hooks]: void prefix on ntfy.send() calls — fire-and-forget consistent with writeHeartbeat pattern, must not block poll loop
- [Phase 02-orchestrator-hooks]: Priority 3 for success, priority 4 for failure notifications — per ntfy numeric scale
- [Phase 02-orchestrator-hooks]: result.result.slice(0, 200) truncation in notification bodies — prevents oversized payloads
- 03-01: INJECTION_MITIGATION_PREAMBLE exported as named constant for test assertions but hardcoded — not configurable per locked CONTEXT.md decision
- 03-01: configDir parameter resolves relative template paths against config file directory, not process.cwd() — avoids stale cwd assumption
- 03-01: Zod v4 requires arrow function factories for .default() on objects/arrays (.default(() => ({}))); z.record(z.string(), z.string()) required for Record<string, string>

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3 (prompt): Skip criteria thresholds will need empirical tuning after first 5 real runs
- Phase 4 (git harness): GIT_CONFIG_NOSYSTEM=1 credential blocking needs integration test on actual machine config
- Phase 4 (Confluence): Macro-stripping bug workaround (append-only plain wiki markup) needs validation against user's Confluence instance before pointing at real log page

## Session Continuity

Last session: 2026-02-25
Stopped at: Completed 03-01-PLAN.md (Agent prompt schema extension, prompt-loader with injection preamble, 4 bead templates)
Resume file: None

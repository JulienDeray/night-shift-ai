# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-02-25
**Phases:** 4 | **Plans:** 8 | **Sessions:** ~4

### What Was Built
- Ntfy push notification platform with fire-and-forget client, per-task opt-in, and orchestrator hooks (start/end with priority escalation)
- 4-bead agent pipeline (analyze/implement/verify/mr) with category fallback, implement retry, and GITLAB_TOKEN isolation
- Git clone lifecycle with unconditional cleanup, GIT_CONFIG_NOSYSTEM isolation, and SSH_AUTH_SOCK forwarding
- Dual logging: JSONL local log + Confluence page update via MCP Atlassian log bead
- Config-driven day-of-week category rotation with strict Zod v4 validation

### What Worked
- TDD (red-green) approach in Phases 2 and 4 produced clean implementations with zero regressions
- Zero new npm dependencies decision held throughout — native fetch, AbortSignal.timeout, and spawnWithTimeout covered all needs
- Strict phase dependency ordering (config -> hooks -> prompt -> harness) meant each phase built cleanly on the last
- Summary files with detailed frontmatter made milestone completion straightforward
- Average plan execution time of 2.1 minutes indicates well-scoped plans

### What Was Inefficient
- Milestone audit was run after Phase 2 completion (before Phases 3-4), producing a stale audit that showed 11/20 requirements orphaned — should have waited until all phases were done
- Zod v4 quirks (arrow function defaults, two-arg z.record) caused minor friction in Phase 3 despite being documented in Phase 1 decisions

### Patterns Established
- Fire-and-forget notification pattern (void prefix, try/catch-all, warn-level logging)
- Guard-then-delegate pattern for notification helpers (check ntfy + task.notify before calling)
- Bead prompt templates with {{variable}} placeholders, command whitelists, and structured JSON output
- buildBeadEnv from explicit allowlist (not process.env filter) for security isolation
- Best-effort bead pattern: wrap in try/catch, log error, never rethrow — preserves pipeline result
- Unconditional finally cleanup for temp directories

### Key Lessons
1. Run milestone audits only when all phases are complete — partial audits create noise and confusion
2. Zod v4 has meaningful behavioral differences from v3 (.default() factories, z.record() arity, .strict() semantics) — document quirks in first encounter and reference in subsequent phases
3. Security isolation is best enforced structurally (allowlist env construction) rather than procedurally (deleting keys from process.env)
4. TDD red-green cycle with atomic commits provides both test coverage and clean git history for free

### Cost Observations
- Model mix: balanced profile (default)
- Sessions: ~4 across 3 days
- Notable: 8 plans completed in ~17 minutes total execution time (avg 2.1 min/plan)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~4 | 4 | Initial milestone — established TDD, bead pipeline, and security isolation patterns |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 238+ | N/A | 0 (zero new npm dependencies) |

### Top Lessons (Verified Across Milestones)

1. Structural security (allowlist construction) beats procedural security (key deletion)
2. Well-scoped plans (~2 min each) execute cleanly and produce atomic commits

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

## Milestone: v2.0 — Pluggable Agent Architecture

**Shipped:** 2026-03-09
**Phases:** 9 | **Plans:** 19

### What Was Built
- Pluggable agent architecture: agents as directories with manifest.yaml and prompt files, driven by generic AgentEngine
- BeadPlugin interface with typed contracts, BeadRegistry for plugin resolution, Zod-validated manifest schema
- Config schema rewritten from hardcoded code-agent to `agents:` array with cron scheduling
- Startup validation gate: daemon fails at start (not 2am) if agent manifests are broken
- Code-agent fully migrated from hardcoded pipeline to configured agent template with zero functionality loss
- All legacy code-agent source files deleted — single dispatch path through AgentEngine
- Developer experience CLI: agent init, validate, list, show with 21 comprehensive tests
- Documentation: README rewrite + docs/agents.md reference guide

### What Worked
- Phase dependency ordering held throughout 9 phases — each phase built cleanly on the last
- Audit-driven gap closure (Phases 12-13) caught a real integration bug (scheduler dispatch wiring) before shipping
- Hard config schema break (`.strict()`) instead of expand-and-contract simplified implementation significantly for a personal tool
- BeadRegistry as DI instance (not singleton) made testing clean across all phases
- Summary frontmatter and VERIFICATION.md files made milestone audit straightforward

### What Was Inefficient
- First milestone audit was run before gap-closure phases were planned — needed a second audit pass
- SUMMARY frontmatter `requirements_completed` was left empty in plans 06-02 and 08-01 (metadata-only debt)
- Phase 10 had flaky parallel test runs due to pre-existing tmpdir race conditions (not introduced by v2.0, but surfaced during it)
- Nyquist validation was skipped for most phases (VALIDATION.md missing for phases 5-10)

### Patterns Established
- Agent directory convention: `agents/<name>/manifest.yaml` + prompt files
- Two-pass validation: ManifestSchema.safeParse for schema, loadManifest for env vars
- Engine statelessness: AgentEngine + BeadRegistry created fresh per dispatch
- Per-bead configuration from manifest (model, tools, env, timeout) overrides engine defaults
- Deferred template resolution: mcpConfig stored as raw string, rendered at plugin execution time
- Scaffold + validate pattern: `agent init` produces output that passes `agent validate`

### Key Lessons
1. Audit-then-fix before milestone completion catches real integration bugs — the scheduler dispatch wiring gap was a genuine bug that would have affected production use
2. Hard schema breaks are appropriate for personal tools — expand-and-contract adds complexity only justified for tools with external users
3. Generic engines should have zero domain-specific logic — the AgentEngine pattern proved correct when code-agent migrated with zero engine changes
4. Startup validation is high-value low-cost — checking manifests before the first poll tick prevents 2am failures
5. Gap-closure phases (decimal or dedicated) are a natural part of milestone completion — plan for 1-2 at the end

### Cost Observations
- Model mix: balanced profile (default)
- Notable: 19 plans across 9 phases in 13 days, 101 commits

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Commits | Key Change |
|-----------|--------|-------|---------|------------|
| v1.0 | 4 | 8 | 42 | Established TDD, bead pipeline, and security isolation patterns |
| v2.0 | 9 | 19 | 101 | Pluggable agent architecture, generic engine, audit-driven gap closure |

### Cumulative Quality

| Milestone | LOC | Tests | Zero-Dep Additions |
|-----------|-----|-------|-------------------|
| v1.0 | 9,068 | 238+ | 0 (zero new npm dependencies) |
| v2.0 | 12,752 | 384+ | 0 (zero new npm dependencies) |

### Top Lessons (Verified Across Milestones)

1. Structural security (allowlist construction) beats procedural security (key deletion)
2. Well-scoped plans execute cleanly and produce atomic commits
3. Audit-then-fix before milestone completion catches real integration bugs
4. Generic engines with zero domain-specific logic scale to new agent types cleanly
5. Startup validation prevents late-night failures — check configuration eagerly

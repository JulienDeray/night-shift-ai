# Phase 17: E2E Testing Framework - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a full E2E test harness covering the daemon lifecycle, agent execution through the step pipeline, CLI commands, error scenarios (failure, timeout, invalid manifest), and external service boundaries — with no real network calls. The mock `claude` shim replaces the real binary via PATH, a localhost HTTP server captures ntfy calls, and multiple purpose-built test agents exercise happy-path, failure, retry/fallback, and timeout scenarios.

</domain>

<decisions>
## Implementation Decisions

### Daemon lifecycle testing
- Fork a real daemon process (same as `nightshift start` does) — tests interact via CLI commands and file-system state
- Detect daemon readiness by polling `daemon.json` for a fresh heartbeat timestamp
- Stop the daemon via CLI `nightshift stop` command — tests the real graceful shutdown path (SIGTERM → orchestrator.stop())
- Include crash recovery tests: SIGKILL the daemon, verify stale PID detection, confirm subsequent `nightshift start` recovers

### External mock strategy
- **Claude CLI**: PATH shim script — create a mock `claude` shell script, prepend its directory to PATH in the test environment. The shim reads `MOCK_CLAUDE_RESPONSE_FILE` env var to load a canned JSON response file, allowing per-test configuration (success, failure, timeout simulation)
- **ntfy**: Start a localhost HTTP server in the test that records requests. Override ntfy URL in the test nightshift.yaml to point to localhost. Verify actual HTTP payloads sent
- **glab**: Not needed — glab is only invoked inside Claude sessions, and the mock claude shim short-circuits the entire agent execution. glab never runs in E2E tests

### Agent execution scope
- Full pipeline depth: start daemon → submit agent → daemon picks up task → real manifest/prompt rendering → hits mock claude shim → generates inbox report → verify report content
- Multiple purpose-built test agents (NOT minimal stubs):
  - **Happy-path agent**: 1 step, succeeds — basic end-to-end verification
  - **Multi-step failure agent**: 2+ steps, first step fails — tests error handling and step failure reporting
  - **Retry/fallback agent**: Tests `retryFrom` (retry current step) and fallback to previous step after max retry attempts — exercises the engine's full retry logic
- Timeout testing: Use very short timeouts (1-2 seconds) in test manifests. Mock claude shim sleeps longer than the timeout to trigger timeout handling. Keeps tests fast
- Each test agent lives as a full agent directory with manifest.yaml and prompt files in the fixture directory

### Test organization
- New `tests/e2e/` directory — separate from unit/ and integration/
- Separate vitest config: `vitest.e2e.config.ts` with longer timeout (60-120s)
- New npm script: `npm run test:e2e`
- `npm test` continues to run only unit + integration (fast)
- Fixture agents inside `tests/e2e/fixtures/` — co-located, self-contained
- Mock scripts (claude shim, response JSON files) also in fixtures
- Separate CI job in GitHub Actions — runs after unit+integration, doesn't block the fast tests

### Claude's Discretion
- Exact localhost HTTP server implementation for ntfy mock (http.createServer or similar)
- Mock claude shim script implementation details (bash script parsing env vars)
- How to structure the daemon helper utilities (start/waitForReady/stop/kill functions)
- Exact vitest.e2e.config.ts settings (timeout value, setup files, etc.)
- Poll interval and max wait time for daemon readiness detection
- Whether to add a shared test helper module for common E2E patterns

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `spawnWithTimeout` (src/utils/process.ts): Already used in integration tests for CLI subprocess spawning — reuse for daemon process management
- Integration test pattern (tests/integration/submit.test.ts): Established `run()` helper, `writeConfig()`, temp directory lifecycle — extend for E2E
- `health.ts` (src/daemon/health.ts): Stale PID detection logic — the crash recovery tests will exercise this directly
- Existing `nightshift.yaml` test configs in integration tests — base for E2E configs

### Established Patterns
- Tests use real temp directories (no fs mocking) — E2E tests follow this pattern
- CLI subprocess spawning via `npx tsx bin/nightshift.ts` — same approach for E2E daemon management
- beforeEach/afterEach for setup/teardown — E2E adds daemon start/stop to this lifecycle
- vitest with `describe`/`it`/`expect` — same assertion library

### Integration Points
- Daemon entry: `src/daemon/index.ts` — forked by `nightshift start`, same entry for E2E
- CLI commands: `bin/nightshift.ts` — all CLI interactions go through the same binary
- Config loading: `src/core/config.ts` — E2E configs follow the same schema
- File-queue: `.nightshift/queue/*.json` — E2E tests verify task files appear and get processed
- Inbox reports: `.nightshift/inbox/*.md` — E2E tests verify reports are generated with correct content
- Notification service: reads ntfy URL from config — E2E overrides to localhost

</code_context>

<specifics>
## Specific Ideas

- Multiple test agents should cover the full spectrum of engine behavior: single step success, multi-step with early failure, retry-from-self, and retry-from-previous-step
- The mock claude shim should be a real shell script on PATH (not an env-var binary override) — zero production code changes for testability
- Tests should verify actual file content (inbox reports, queue files) not just exit codes

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 17-e2e-testing-framework*
*Context gathered: 2026-03-13*

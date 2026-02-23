---
phase: 01-notification-foundation
plan: 02
subsystem: notifications
tags: [ntfy, http, fetch, typescript, vitest, fire-and-forget]

# Dependency graph
requires:
  - phase: 01-01
    provides: NtfyConfig interface from src/core/types.ts (topic, token, baseUrl)
provides:
  - NtfyClient class at src/notifications/ntfy-client.ts with send() fire-and-forget method
  - NtfyMessage interface (title, body, priority, tags, actions)
  - NtfyAction interface for future ntfy action buttons
  - 9 unit tests covering all send() behaviors
affects:
  - Phase 2 (orchestrator instantiates NtfyClient from ntfy config and calls send() on task completion)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fire-and-forget pattern — send() catches all errors internally, never throws, never retries
    - Global fetch usage — no import, Node 22 global; AbortSignal.timeout(5000) for HTTP timeout
    - Property name mapping — NtfyMessage.body maps to JSON "message" field to match ntfy wire format
    - vi.stubGlobal("fetch", ...) pattern for mocking global fetch in vitest unit tests

key-files:
  created:
    - src/notifications/ntfy-client.ts
    - tests/unit/ntfy-client.test.ts
  modified: []

key-decisions:
  - "Use AbortSignal.timeout(5000) — no manual AbortController needed, Node 22 supports it natively"
  - "NtfyMessage.body maps to JSON field message — property named body for clarity, wire format uses ntfy convention"
  - "No module-level fetch import — Node 22 has fetch as a global, consistent with zero new dependencies decision"

patterns-established:
  - "Pattern 3: Fire-and-forget notification client — wrap entire send body in try/catch, log at warn level on failure, never throw"
  - "Pattern 4: Global fetch mock in vitest — vi.stubGlobal('fetch', mockFn) with vi.restoreAllMocks() in afterEach"

requirements-completed: [NTFY-02]

# Metrics
duration: 1min
completed: 2026-02-23
---

# Phase 1 Plan 02: NtfyClient Summary

**NtfyClient class with fire-and-forget HTTP POST to ntfy, 5-second AbortSignal timeout, bearer auth, body-to-message field mapping, and 9 unit tests covering all failure paths**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-23T15:13:27Z
- **Completed:** 2026-02-23T15:14:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created NtfyClient class that fires HTTP POST to ntfy and never throws under any circumstances
- NtfyMessage.body correctly maps to JSON "message" field per ntfy API convention
- AbortSignal.timeout(5000) provides 5-second timeout without manual AbortController
- Bearer token header included when configured, omitted when absent
- Trailing slash stripped from baseUrl to prevent double-slash in assembled URL
- 9 unit tests covering URL assembly, payload mapping, auth, and all failure paths (4xx, 5xx, network error, timeout)
- Full test suite (153 tests) passes with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement NtfyClient class** - `adcdd76` (feat)
2. **Task 2: Add NtfyClient unit tests** - `5f73ea1` (test)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/notifications/ntfy-client.ts` - NtfyClient class, NtfyMessage interface, NtfyAction interface
- `tests/unit/ntfy-client.test.ts` - 9 unit tests for NtfyClient behaviors

## Decisions Made
- Used `AbortSignal.timeout(5000)` rather than a manual AbortController — cleaner API, native to Node 22
- Named the TypeScript property `body` (not `message`) for clarity at call sites, but the wire format correctly uses the `message` key per ntfy API convention
- Did not add a fetch import — Node 22 provides it as a global, consistent with the project's zero new npm dependencies decision

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- NtfyClient is ready for use by the Phase 2 orchestrator
- Orchestrator can instantiate `new NtfyClient(config.ntfy)` and call `client.send(message, logger)` on task completion
- NtfyClient is optional — orchestrator should check `config.ntfy !== undefined` before instantiating

## Self-Check: PASSED

- FOUND: src/notifications/ntfy-client.ts
- FOUND: tests/unit/ntfy-client.test.ts
- FOUND commit: adcdd76 (feat: NtfyClient implementation)
- FOUND commit: 5f73ea1 (test: NtfyClient unit tests)

---
*Phase: 01-notification-foundation*
*Completed: 2026-02-23*

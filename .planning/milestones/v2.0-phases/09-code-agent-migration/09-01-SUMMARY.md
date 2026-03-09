---
phase: 09-code-agent-migration
plan: "01"
subsystem: agent
tags: [manifest, schema, zod, retry, mcp, preamble, engine, bead-plugin]

# Dependency graph
requires:
  - phase: 08-agentengine-and-bead-plugin-implementations
    provides: AgentEngine, StandardBeadPlugin, BeadRegistry, engine-types baseline
provides:
  - mcpConfig field on BeadSchema, ResolvedBead, and StandardBeadPlugin (raw passthrough + deferred resolution via template engine)
  - RetrySchema and retry field on BeadSchema with retryFrom validation against preceding beads
  - mcp__* prefix accepted in allowedTools at schema level
  - INJECTION_MITIGATION_PREAMBLE prepended by StandardBeadPlugin before prompt
  - beadOutputs field on AgentRunResult for caller inspection
  - Engine retry loop with retryFrom jump, retry_error injection, and git reset --hard HEAD
affects:
  - 09-02: code-agent manifest will use mcpConfig, retry, mcp__ tools
  - 09-03: daemon will read beadOutputs for category fallback logic

# Tech tracking
tech-stack:
  added: []
  patterns:
    - mcpConfig deferred resolution: stored as raw string on ResolvedBead, rendered through template engine at plugin execution time before path.join
    - Retry semantics: trigger bead declares retry config; engine detects passed===false in output; retryCount persists across entire run to cap total retries
    - preamble-first: StandardBeadPlugin always prepends INJECTION_MITIGATION_PREAMBLE + separator before rendered prompt

key-files:
  created: []
  modified:
    - src/agent/manifest-schema.ts
    - src/agent/manifest-types.ts
    - src/agent/manifest-loader.ts
    - src/agent/plugins/standard-bead-plugin.ts
    - src/agent/engine-types.ts
    - src/agent/engine.ts
    - tests/unit/manifest-schema.test.ts
    - tests/unit/standard-bead-plugin.test.ts
    - tests/unit/engine.test.ts

key-decisions:
  - "mcpConfig stored as raw string on ResolvedBead (not resolved at load time) — template variables like {{mcp_config_path}} must be rendered at plugin execution time before path.join"
  - "retryCount not reset between beads — it persists across the entire run to enforce maxAttempts cap correctly when retrying via implement→verify loop"
  - "mcp__* prefix accepted in allowedTools via !t.startsWith('mcp__') filter — error message updated to mention 'or any mcp__* tool'"
  - "spawnWithTimeout spy approach used in engine tests (vi.spyOn) rather than vi.mock — avoids vi.restoreAllMocks() clearing the module-level mock between tests"

patterns-established:
  - "Retry trigger convention: any bead whose output has passed===false and declares retry config triggers a loop back to retryFrom bead"
  - "Template-first mcpConfig resolution: renderAgentTemplate on mcpConfig value, then path.isAbsolute check before path.join(agentDir, ...)"

requirements-completed:
  - MIGR-01

# Metrics
duration: 20min
completed: 2026-02-27
---

# Phase 09 Plan 01: Schema, Plugin, and Engine Extensions for Code-Agent Migration

**Extended BeadSchema with mcpConfig+retry fields, StandardBeadPlugin with preamble injection and deferred mcpConfig resolution, and engine retry loop with git reset, retry_error injection, and beadOutputs exposure**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-02-27T18:35:00Z
- **Completed:** 2026-02-27T18:51:40Z
- **Tasks:** 2 completed
- **Files modified:** 9

## Accomplishments

- ManifestSchema accepts `mcpConfig` (relative path or template variable), `retry` (maxAttempts + retryFrom), and `mcp__*` tools in allowedTools — all with proper validation
- StandardBeadPlugin prepends `INJECTION_MITIGATION_PREAMBLE`, renders `mcpConfig` through the template engine before `path.join`, and forwards `mcpConfigPath` to `runBead`
- Engine bead loop converted to while-based with retry: detects `passed===false`, jumps back to `retryFrom` bead, injects `retry_error`, calls `git reset --hard HEAD` via `resetWorkDir`
- `beadOutputs` field added to `AgentRunResult` and populated on both success and failure paths

## Task Commits

1. **Task 1: Schema, types, and plugin extensions** - `1d8101b` (feat)
2. **Task 2: Engine retry loop and beadOutputs population** - `a4138e9` (feat)

## Files Created/Modified

- `src/agent/manifest-schema.ts` - Added RetrySchema, mcpConfig/retry fields to BeadSchema, mcp__* allowance in validateAllowedTools, retryFrom validation in ManifestSchema
- `src/agent/manifest-types.ts` - Added mcpConfig? and retry? fields to ResolvedBead interface
- `src/agent/manifest-loader.ts` - Pass through raw mcpConfig string and retry config in resolveBeadConfig
- `src/agent/plugins/standard-bead-plugin.ts` - Import INJECTION_MITIGATION_PREAMBLE, prepend to prompt, resolve mcpConfig through template engine, pass mcpConfigPath to runBead
- `src/agent/engine-types.ts` - Added beadOutputs?: Record<string, unknown> to AgentRunResult
- `src/agent/engine.ts` - Import spawnWithTimeout, add resetWorkDir method, convert for loop to while loop with retry logic, populate beadOutputs
- `tests/unit/manifest-schema.test.ts` - 8 new tests for mcp__ tools, mcpConfig, retry validation
- `tests/unit/standard-bead-plugin.test.ts` - 4 new tests for preamble injection, mcpConfigPath resolution (template var and relative literal)
- `tests/unit/engine.test.ts` - 6 new tests for retry flow, retry_error injection, git reset, beadOutputs

## Decisions Made

- **mcpConfig deferred resolution:** mcpConfig stored as raw string on ResolvedBead. Template variables (e.g., `{{mcp_config_path}}`) are only resolved at plugin execution time via `renderAgentTemplate`, then checked with `path.isAbsolute` before `path.join`. This avoids `path.join(agentDir, "{{mcp_config_path}}")` producing a broken path.
- **retryCount persistence:** `retryCount` is NOT reset between beads. It persists across the entire run. This correctly enforces `maxAttempts` when an implement→verify loop retries, because resetting the counter when implement succeeds would allow infinite retries.
- **vi.spyOn approach for git reset test:** Using `vi.spyOn(processUtils, "spawnWithTimeout")` instead of `vi.mock("../../src/utils/process.js")`. The module-level mock approach caused `vi.restoreAllMocks()` in afterEach to clear the mock's return value, causing `const { result } = undefined` to throw during retry in subsequent tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed engine test mock isolation issue**
- **Found during:** Task 2 (engine retry tests)
- **Issue:** Using `vi.mock("../../src/utils/process.js")` to mock `spawnWithTimeout` was cleared by `vi.restoreAllMocks()` in the outer `afterEach`, causing subsequent retry tests to throw `TypeError: Cannot destructure property 'result' of undefined` in `resetWorkDir`
- **Fix:** Removed the module-level `vi.mock` for process.js; used `vi.spyOn(processUtils, "spawnWithTimeout")` directly in the "calls git reset before retry" test. All other retry tests let the real `spawnWithTimeout` run (git exits 128 in a non-git tmpdir, but `resetWorkDir` doesn't check exit code)
- **Files modified:** tests/unit/engine.test.ts
- **Verification:** All 33 engine tests pass including all 6 new retry tests
- **Committed in:** a4138e9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test mock setup)
**Impact on plan:** Bug was in the test infrastructure, not the implementation. Fix ensures correct test isolation without affecting engine behavior.

## Issues Encountered

None in the implementation itself. The test mock isolation issue (described in Deviations) was caught and fixed during Task 2 verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 09 Plan 02 can now wire the code-agent manifest to use `mcpConfig`, `retry`, and `mcp__atlassian__getConfluencePage` in `allowedTools`
- Phase 09 Plan 03 can use `beadOutputs` from `AgentRunResult` for the daemon's category fallback logic
- All features are generic (manifest-driven) — zero code-agent-specific logic in engine.ts confirmed

---
*Phase: 09-code-agent-migration*
*Completed: 2026-02-27*

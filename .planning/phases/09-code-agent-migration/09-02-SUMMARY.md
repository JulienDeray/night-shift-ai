---
phase: 09-code-agent-migration
plan: "02"
subsystem: agent
tags: [code-agent, manifest, prompts, integration-test, pipeline, bead-outputs]

# Dependency graph
requires:
  - phase: 09-code-agent-migration
    plan: "01"
    provides: mcpConfig, retry, beadOutputs on AgentRunResult, engine retry loop
provides:
  - agents/code-agent/manifest.yaml with full 6-bead pipeline (clone, analyze, implement, verify, mr, log)
  - Adapted prompt files using {{beads.*}} cross-bead variables and JSON code block output
  - Integration test proving pipeline runs through AgentEngine with correct outcome shapes
  - GitCloneBeadPlugin rawOutput wrapped in JSON code block (required by validateBeadOutput)
affects:
  - 09-03: daemon will run AgentEngine with the code-agent directory
  - Phase 10: category fallback logic reads beadOutputs.analyze.result for NO_IMPROVEMENT detection

# Tech tracking
tech-stack:
  added: []
  patterns:
    - JSON code block output convention: all beads (including git-clone) wrap output in ```json code blocks for validateBeadOutput compatibility
    - retry_error manifest variable: declared with empty string default so dryRun validates successfully; engine overwrites on retry
    - cross-bead data access: {{beads.bead_name.output.field}} pattern used in implement, mr, and log prompts

key-files:
  created:
    - agents/code-agent/manifest.yaml
    - agents/code-agent/prompts/clone-stub.md
    - agents/code-agent/prompts/analyze.md
    - agents/code-agent/prompts/implement.md
    - agents/code-agent/prompts/verify.md
    - agents/code-agent/prompts/mr.md
    - agents/code-agent/prompts/log.md
    - tests/unit/code-agent-manifest.test.ts
  modified:
    - src/agent/plugins/git-clone-bead-plugin.ts
    - tests/unit/git-clone-bead-plugin.test.ts

key-decisions:
  - "retry_error declared in manifest variables with empty string default so dryRun validates implement.md without error — engine overwrites with actual error details on retry"
  - "GitCloneBeadPlugin rawOutput wrapped in JSON code block format (```json...```) — required because validateBeadOutput uses extractLastJsonBlock which only matches code block syntax"
  - "vi.spyOn approach for git reset in retry test — same pattern as Plan 01; avoids vi.restoreAllMocks() clearing module-level mocks between tests"
  - "agentsRoot path hardcoded as path.resolve('agents') pointing to real repo directory — integration test uses the real code-agent directory for dryRun and pipeline tests"

patterns-established:
  - "All bead plugins must return rawOutput as JSON code blocks (not plain JSON) for validateBeadOutput compatibility"
  - "Manifest variables provide dryRun-safe defaults for engine-injected variables (retry_error: empty string)"

requirements-completed:
  - MIGR-01

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 09 Plan 02: Code-Agent Directory and Integration Test

**6-bead code-agent manifest with adapted prompts using {{beads.*}} cross-bead variables, JSON code block output, and integration test proving end-to-end pipeline execution through AgentEngine with mocked beads**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-27T18:54:40Z
- **Completed:** 2026-02-27T19:01:25Z
- **Tasks:** 2 completed
- **Files modified:** 10 (8 created, 2 modified)

## Accomplishments

- Created `agents/code-agent/` directory with `manifest.yaml` declaring full 6-bead pipeline: clone (git-clone type), analyze (standard), implement (standard), verify (standard with retry), mr (standard), log (standard with mcpConfig)
- Adapted all 5 prompt files from v1.0: replaced `{{date}}` with `{{run_date}}`, removed `{{handoff_file}}`/`{{analysis_file}}`, replaced with `{{beads.*}}` cross-bead variables and JSON code block output
- Created integration test with 5 tests: dryRun validation, MR_CREATED pipeline, NO_IMPROVEMENT detection, agent portability, and verify retry triggering implement re-run
- Fixed GitCloneBeadPlugin to wrap rawOutput in JSON code block format (bug: `validateBeadOutput` uses `extractLastJsonBlock` which only finds ````json...```` blocks, not plain JSON)
- Added `retry_error: ""` to manifest variables so dryRun validates implement.md's `{{retry_error}}` reference without error

## Task Commits

1. **Task 1: Create agents/code-agent/ directory with manifest.yaml and adapted prompt files** - `6fdb491` (feat)
2. **Task 2: Integration test — run code-agent through AgentEngine with mocked beads** - `5d5799f` (feat)

## Files Created/Modified

- `agents/code-agent/manifest.yaml` - Full 6-bead pipeline with models, tools, env vars, timeouts, output schemas, retry config, and mcpConfig
- `agents/code-agent/prompts/clone-stub.md` - Stub prompt for git-clone bead (handled by plugin)
- `agents/code-agent/prompts/analyze.md` - Adapted: {{run_date}}, {{categoryUsed}} in JSON output, code block output instead of file write
- `agents/code-agent/prompts/implement.md` - Adapted: {{beads.analyze.output.selected.*}} for analysis data, {{retry_error}} for retry context, code block output
- `agents/code-agent/prompts/verify.md` - Adapted: {{allowed_commands}} (was {{build_commands}}), code block output, no file write
- `agents/code-agent/prompts/mr.md` - Adapted: {{beads.analyze.output.*}} for description/candidates, code block output with MR URL
- `agents/code-agent/prompts/log.md` - Adapted: {{beads.analyze.output.categoryUsed}}, {{beads.mr.output.mr_url}}, {{beads.analyze.output.selected.description}} for run record
- `src/agent/plugins/git-clone-bead-plugin.ts` - Fixed rawOutput to use JSON code block format for validateBeadOutput compatibility
- `tests/unit/git-clone-bead-plugin.test.ts` - Updated test to match new rawOutput format
- `tests/unit/code-agent-manifest.test.ts` - 5 integration tests verifying manifest loads, pipeline runs, beadOutputs accessible, portability, retry

## Decisions Made

- **retry_error manifest variable:** Added `retry_error: ""` to manifest variables. The engine injects the actual error on retry, overwriting the empty default. This allows dryRun to validate `implement.md`'s `{{retry_error}}` reference (validateTemplateVars only fails on `undefined`, not empty string).
- **GitCloneBeadPlugin rawOutput format:** Changed from `JSON.stringify({...})` to ````json\n...\n```` code block format. `validateBeadOutput` calls `extractLastJsonBlock` which only matches `` ```json `` code blocks — plain JSON was silently failing with `BeadOutputMissingError`.
- **vi.spyOn for git reset in retry test:** Same decision as Plan 01 — avoids `vi.restoreAllMocks()` clearing module-level mocks between tests.
- **Hardcoded agentsRoot:** Integration test uses `path.resolve("agents")` pointing to the real code-agent directory. This ensures the dryRun and pipeline tests validate actual files, not synthetic temp files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed GitCloneBeadPlugin rawOutput format incompatibility with validateBeadOutput**
- **Found during:** Task 1 (while analyzing code before implementing Task 2 tests)
- **Issue:** `GitCloneBeadPlugin.execute()` returned `rawOutput: JSON.stringify({...})` — plain JSON without a code block wrapper. `validateBeadOutput` calls `extractLastJsonBlock` which only matches `` ```json `` or ` ``` ` code blocks. This caused the git-clone bead to always fail with `BeadOutputMissingError` when run through the engine.
- **Fix:** Changed `GitCloneBeadPlugin` to wrap its JSON payload in a code block: `` "```json\n" + payload + "\n```" ``
- **Files modified:** `src/agent/plugins/git-clone-bead-plugin.ts`, `tests/unit/git-clone-bead-plugin.test.ts`
- **Commit:** `6fdb491` (included in Task 1 commit)

**2. [Rule 2 - Missing functionality] Added retry_error to manifest variables for dryRun compatibility**
- **Found during:** Task 1 (while analyzing template variable validation)
- **Issue:** `implement.md` references `{{retry_error}}` which the engine injects at runtime during retries. However, `dryRun` calls `validateTemplateVars` which throws `ManifestError` for any non-`beads.*` variable not present in the resolved vars at load time.
- **Fix:** Added `retry_error: ""` to manifest `variables` block. Empty string passes `validateTemplateVars` (it only fails on `undefined`). The engine overwrites this with actual error details on retry.
- **Files modified:** `agents/code-agent/manifest.yaml`
- **Commit:** `6fdb491` (included in Task 1 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 - bug, Rule 2 - missing functionality for dryRun compatibility)
**Impact on plan:** Both fixes are required for correctness. Without Fix 1, the entire git-clone pipeline would fail silently. Without Fix 2, dryRun validation would throw on every startup.

## Issues Encountered

None beyond the deviations documented above, which were identified and fixed proactively.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 09 Plan 03 (daemon integration) can now wire `AgentEngine` with the `agents/code-agent/` directory
- `beadOutputs.analyze.result` is exposed for NO_IMPROVEMENT detection in the daemon's category fallback logic
- The agent directory is self-contained and portable — confirmed by portability integration test

## Self-Check: PASSED

Files verified:
- `agents/code-agent/manifest.yaml` - exists
- `agents/code-agent/prompts/analyze.md` - exists
- `agents/code-agent/prompts/implement.md` - exists
- `agents/code-agent/prompts/verify.md` - exists
- `agents/code-agent/prompts/mr.md` - exists
- `agents/code-agent/prompts/log.md` - exists
- `agents/code-agent/prompts/clone-stub.md` - exists
- `tests/unit/code-agent-manifest.test.ts` - exists

Commits verified:
- `6fdb491` - Task 1 commit (feat(09-02): create code-agent directory...)
- `5d5799f` - Task 2 commit (feat(09-02): add integration test...)

---
*Phase: 09-code-agent-migration*
*Completed: 2026-02-27*

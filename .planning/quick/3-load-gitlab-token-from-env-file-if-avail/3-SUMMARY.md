---
phase: quick-3
plan: 01
subsystem: infra
tags: [env, dotenv, startup, secrets, gitlab-token]

requires: []
provides:
  - loadEnvFile utility with zero external dependencies
  - .env file support at both CLI and daemon entrypoints
affects: [bin/nightshift.ts, src/daemon/index.ts]

tech-stack:
  added: []
  patterns:
    - "loadEnvFile called synchronously at process startup before any async work"
    - "Shell-exported env vars always take precedence over .env file values"

key-files:
  created:
    - src/utils/env-loader.ts
    - tests/unit/env-loader.test.ts
  modified:
    - bin/nightshift.ts
    - src/daemon/index.ts
    - .gitignore

key-decisions:
  - "No external dependency (no dotenv package) — custom parser for KEY=VALUE, quoted values, comments"
  - "Existing process.env values are never overridden — shell-exported GITLAB_TOKEN always wins"
  - "ENOENT is silently swallowed; all other fs errors are re-thrown"
  - "loadEnvFile uses process.cwd() as default base — same directory as nightshift.yaml"

requirements-completed: [QUICK-3]

duration: 2min
completed: 2026-02-25
---

# Quick Task 3: Load GitLab Token from .env File Summary

**Zero-dependency .env loader that makes GITLAB_TOKEN available at startup from a file co-located with nightshift.yaml, with shell env vars always winning.**

## Performance

- **Duration:** ~2 minutes
- **Started:** 2026-02-25T17:41:00Z
- **Completed:** 2026-02-25T17:42:57Z
- **Tasks:** 2 completed
- **Files modified:** 5

## Accomplishments

- Created `src/utils/env-loader.ts` — synchronous .env parser with no external dependencies
- Wired `loadEnvFile()` into both entrypoints (CLI and daemon) before any business logic
- Added `.env` to `.gitignore` to prevent accidental secret commits
- 8 unit tests covering all edge cases including the critical non-override security invariant

## Task Commits

1. **Task 1: Create env-loader utility and tests** - `cbb7a56` (feat)
2. **Task 2: Wire env-loader into CLI and daemon entrypoints** - `9fafd83` (feat)

**Plan metadata:** `[pending]` (docs: complete plan)

## Files Created/Modified

- `src/utils/env-loader.ts` - Synchronous .env file parser, exports `loadEnvFile(base?: string): void`
- `tests/unit/env-loader.test.ts` - 8 unit tests covering parsing, quoting, comments, non-override behaviour, missing file
- `bin/nightshift.ts` - Added `loadEnvFile()` call before `program.parse()`
- `src/daemon/index.ts` - Added `loadEnvFile()` call before `Orchestrator` creation
- `.gitignore` - Added `.env` entry

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `src/utils/env-loader.ts` exists: FOUND
- `tests/unit/env-loader.test.ts` exists: FOUND
- `bin/nightshift.ts` contains `loadEnvFile`: FOUND
- `src/daemon/index.ts` contains `loadEnvFile`: FOUND
- `.gitignore` contains `.env`: FOUND
- Commits `cbb7a56` and `9fafd83` exist: FOUND
- All 259 tests pass: PASSED
- `npx tsc --noEmit` clean: PASSED

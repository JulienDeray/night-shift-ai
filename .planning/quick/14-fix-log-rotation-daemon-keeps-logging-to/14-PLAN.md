---
phase: quick-14
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/logger.ts
  - tests/unit/logger.test.ts
autonomous: true
requirements: [QUICK-14]
must_haves:
  truths:
    - "Daemon logger writes to a new dated file after midnight without restart"
    - "Daemon logger continues writing to the same file within a single day"
    - "Existing CLI logger behavior is unchanged"
  artifacts:
    - path: "src/core/logger.ts"
      provides: "Dynamic date-based log file rotation"
      contains: "logsDir"
    - path: "tests/unit/logger.test.ts"
      provides: "Tests proving log rotation works across date boundaries"
  key_links:
    - from: "src/core/logger.ts write()"
      to: "computed log file path"
      via: "dynamic date computation on each write"
      pattern: "new Date.*toISOString.*split"
---

<objective>
Fix daemon logger to rotate log files at midnight by computing the dated file path dynamically on each write instead of once at creation time.

Purpose: The daemon runs continuously overnight. When it crosses midnight, logs must go to a new date-stamped file. Currently `logFile` is computed once in `createDaemonLogger` and never updated.
Output: Patched `src/core/logger.ts` with dynamic date resolution, plus unit tests proving rotation.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/core/logger.ts
@src/core/paths.ts
@tests/unit/run-logger.test.ts (reference for test patterns/mocking style)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add logsDir field and dynamic file path resolution to Logger</name>
  <files>src/core/logger.ts, tests/unit/logger.test.ts</files>
  <behavior>
    - Test 1: createDaemonLogger produces a logger that writes to a file matching `daemon-YYYY-MM-DD.log` pattern
    - Test 2: When the system date changes (mock Date), the next write goes to a NEW file path with the new date
    - Test 3: Multiple writes within the same date all go to the same file
    - Test 4: CLI logger (stdout-only, no logFile) is unaffected by the change
  </behavior>
  <action>
    1. Create `tests/unit/logger.test.ts` following the mocking patterns from `run-logger.test.ts` (mock `node:fs/promises` and `../../src/core/paths.js`). Write failing tests for the behaviors above. Use `vi.spyOn(globalThis, 'Date')` or `vi.setSystemTime()` to simulate date changes between writes.

    2. Modify `src/core/logger.ts`:
       - Add a private `logsDir: string | null = null` field to the Logger class
       - Add `logsDir` to the constructor options interface
       - In `createDaemonLogger`: pass `logsDir` to the constructor (keep also setting `logFile` to the initial dated path for immediate use)
       - In the `write` method: when `this.logsDir` is set, recompute the log file path using `new Date().toISOString().split("T")[0]` and `path.join(this.logsDir, \`daemon-\${date}.log\`)` before calling `fs.appendFile`. This replaces `this.logFile` dynamically.
       - Do NOT change CLI logger behavior (it has no logsDir, only stdout)

    3. Run tests to confirm they pass.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/logger.test.ts</automated>
  </verify>
  <done>Logger dynamically computes dated file path on each write when logsDir is set. Tests prove file rotation across date boundaries. CLI logger unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Verify full test suite passes</name>
  <files></files>
  <action>
    Run the full test suite to ensure no regressions. The logger change should not affect any other code since the public API (debug/info/warn/error methods) is unchanged and createDaemonLogger still returns a Logger with the same interface.

    Also run `npx tsc --noEmit` to confirm type correctness.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run && npx tsc --noEmit</automated>
  </verify>
  <done>All existing tests pass. TypeScript compilation succeeds with no errors.</done>
</task>

</tasks>

<verification>
- `npx vitest run` passes all tests including new logger rotation tests
- `npx tsc --noEmit` compiles cleanly
- Logger class public API unchanged (debug/info/warn/error signatures identical)
</verification>

<success_criteria>
- Daemon logger writes to date-stamped files that change at midnight
- New unit tests prove cross-midnight rotation
- No regressions in existing test suite
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/14-fix-log-rotation-daemon-keeps-logging-to/14-SUMMARY.md`
</output>

---
phase: quick-12
plan: 01
subsystem: agent-engine
tags: [retry, schema-validation, self-retry, tdd]
dependency_graph:
  requires: []
  provides: [self-retry support in manifest schema and engine]
  affects: [src/agent/manifest-schema.ts, src/agent/engine.ts]
tech_stack:
  added: []
  patterns: [conditional skip of resetWorkDir for self-referencing retryFrom]
key_files:
  created: []
  modified:
    - src/agent/manifest-schema.ts
    - src/agent/engine.ts
    - tests/unit/manifest-schema.test.ts
    - tests/unit/engine.test.ts
decisions:
  - "Used slice(0, i+1) instead of slice(0, i) to include current bead in valid retryFrom targets"
  - "Condition retryFromIndex !== i guards the git reset call — no new abstraction needed"
metrics:
  duration: 10m
  completed: "2026-03-11"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 12: Allow retryFrom Self-Reference Summary

**One-liner:** Self-retry pattern via retryFrom referencing current bead, skipping git reset since there is nothing to undo.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Allow retryFrom to reference current bead in schema validation | 9aef1be | src/agent/manifest-schema.ts, tests/unit/manifest-schema.test.ts |
| 2 | Skip git reset on self-retry and add engine tests | 8106a46 | src/agent/engine.ts, tests/unit/engine.test.ts |

## Changes Made

### src/agent/manifest-schema.ts

Changed `names.slice(0, i)` to `names.slice(0, i + 1)` in the `beads` array superRefine. This includes the current bead's own name in the set of valid retryFrom targets. Updated the error message from "preceding bead name" to "preceding or current bead name" and the label from "Preceding beads" to "Valid beads".

### src/agent/engine.ts

Added a conditional check around the `resetWorkDir` call in the retry trigger block:

```ts
if (retryFromIndex !== i) {
  await this.resetWorkDir(ctx.workDir);
}
```

When a bead retries itself (`retryFromIndex === i`), there is no prior work in the temp dir to undo, so the git reset is skipped. All other retry behavior (maxAttempts tracking, retry_error injection, bead re-execution) is unchanged.

### tests/unit/manifest-schema.test.ts

Added two new test cases:
- Self-referencing retryFrom (bead name equals retryFrom) passes validation
- Forward-referencing retryFrom (pointing to a later bead) still fails validation

Updated the existing "nonexistent preceding bead" test to match either the old or new error message text (backward-compatible assertion).

### tests/unit/engine.test.ts

Added three new test cases to the "retry loop" describe block:
- Self-retry re-executes same bead when retryFrom references itself (fail then pass)
- Self-retry does NOT call git reset --hard (spawnWithTimeout spy confirms no git reset calls)
- Self-retry respects maxAttempts (always-failing bead stops after maxAttempts + 1 total runs)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

Full test suite: 445 tests passed across 34 test files. No regressions.

## Self-Check: PASSED

- src/agent/manifest-schema.ts: exists
- src/agent/engine.ts: exists
- tests/unit/manifest-schema.test.ts: exists
- tests/unit/engine.test.ts: exists
- Commit 9aef1be: feat(quick-12): allow retryFrom to reference current bead in schema validation
- Commit 8106a46: feat(quick-12): skip git reset on self-retry in engine

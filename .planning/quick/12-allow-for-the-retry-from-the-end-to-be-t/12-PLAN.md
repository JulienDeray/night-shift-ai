---
phase: quick-12
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/agent/manifest-schema.ts
  - src/agent/engine.ts
  - tests/unit/engine.test.ts
  - tests/unit/manifest-schema.test.ts
autonomous: true
requirements: [QUICK-12]

must_haves:
  truths:
    - "A bead's retry.retryFrom can reference the bead's own name (self-retry)"
    - "Self-retry skips git reset --hard (no work to undo)"
    - "Self-retry still respects maxAttempts limit"
    - "Existing retryFrom behavior (referencing a preceding bead) is unchanged"
  artifacts:
    - path: "src/agent/manifest-schema.ts"
      provides: "Updated validation allowing retryFrom to reference current bead"
    - path: "src/agent/engine.ts"
      provides: "Skip git reset when retryFrom targets the current bead"
    - path: "tests/unit/engine.test.ts"
      provides: "Self-retry test cases"
    - path: "tests/unit/manifest-schema.test.ts"
      provides: "Schema validation test for self-referencing retryFrom"
  key_links:
    - from: "src/agent/manifest-schema.ts"
      to: "src/agent/engine.ts"
      via: "retryFrom validation allows current bead name"
      pattern: "precedingNames.*slice.*0.*i\\+1|includeSelf"
---

<objective>
Allow retryFrom to reference the current bead (self-retry). Currently, the manifest schema validation requires retryFrom to reference a strictly preceding bead. This change relaxes the constraint so retryFrom can also be the bead's own name, enabling a bead to retry itself when it fails (e.g., a verify bead that gets passed:false and just needs another attempt without going back to an earlier bead).

Purpose: Enables simpler retry patterns where a bead just needs to be re-run without rewinding the pipeline.
Output: Updated schema validation, engine skip-reset logic, and tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/manifest-schema.ts
@src/agent/engine.ts
@src/agent/engine-types.ts
@src/agent/manifest-types.ts
@tests/unit/engine.test.ts
@tests/unit/manifest-schema.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Allow retryFrom to reference current bead in schema validation</name>
  <files>src/agent/manifest-schema.ts, tests/unit/manifest-schema.test.ts</files>
  <behavior>
    - Test: A bead with retry.retryFrom set to its own name passes schema validation
    - Test: A bead with retry.retryFrom set to a preceding bead name still passes (no regression)
    - Test: A bead with retry.retryFrom set to a following bead name still fails validation
    - Test: A bead with retry.retryFrom set to a non-existent name still fails validation
  </behavior>
  <action>
In `src/agent/manifest-schema.ts`, change the retry.retryFrom validation in the `beads` array superRefine (around line 83-95). Currently it uses `names.slice(0, i)` to get preceding bead names. Change it to `names.slice(0, i + 1)` so it includes the current bead's own name. Update the error message from "preceding bead name" to "preceding or current bead name" (and update the label in the error from "Preceding beads" to "Valid beads").

In `tests/unit/manifest-schema.test.ts`, add test cases verifying:
1. Self-referencing retryFrom (bead name equals retryFrom) passes validation
2. Forward-referencing retryFrom (pointing to a later bead) still fails
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/manifest-schema.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>Schema validation accepts retryFrom referencing the current bead's own name while still rejecting forward references. All existing manifest-schema tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Skip git reset on self-retry and add engine tests</name>
  <files>src/agent/engine.ts, tests/unit/engine.test.ts</files>
  <behavior>
    - Test: A bead with retryFrom pointing to itself re-executes without git reset --hard
    - Test: A bead with retryFrom pointing to itself respects maxAttempts
    - Test: A bead with retryFrom pointing to a preceding bead still triggers git reset (no regression)
  </behavior>
  <action>
In `src/agent/engine.ts`, in the retry trigger block (around line 240-265), add a conditional check before calling `this.resetWorkDir()`. If `retryFromIndex === i` (the retry target is the current bead), skip the git reset. The reset is only meaningful when jumping back to a previous bead that will redo work. When retrying the current bead (e.g., a verify step), there is nothing to undo.

Change this section (approximately lines 260-264):
```
// Reset working directory before retry
await this.resetWorkDir(ctx.workDir);

// Jump back to retryFrom bead
i = retryFromIndex;
```

To:
```
// Reset working directory before retry (skip for self-retry — nothing to undo)
if (retryFromIndex !== i) {
  await this.resetWorkDir(ctx.workDir);
}

// Jump back to retryFrom bead (or re-run current bead for self-retry)
i = retryFromIndex;
```

In `tests/unit/engine.test.ts`, add to the "retry loop" describe block:
1. Test "self-retry: re-executes same bead when retryFrom references itself" — single bead with retry pointing to itself, verify it runs twice (fail then pass), pipeline succeeds
2. Test "self-retry: does NOT call git reset --hard" — spy on spawnWithTimeout, confirm no git reset calls when self-retrying
3. Test "self-retry: respects maxAttempts" — always-failing self-retry stops after maxAttempts

Use the same test patterns as the existing retry tests. For self-retry tests, create a single-bead or two-bead manifest where the bead with retry has `retryFrom` set to its own name.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/engine.test.ts --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>Self-retry skips git reset, respects maxAttempts, and all existing retry tests continue to pass unchanged.</done>
</task>

</tasks>

<verification>
Run the full test suite to ensure no regressions:
```bash
cd /Users/julienderay/code/night-shift && npx vitest run --reporter=verbose 2>&1 | tail -50
```
</verification>

<success_criteria>
- retryFrom can reference the current bead's own name (self-retry) in manifest.yaml
- Self-retry does not trigger git reset --hard HEAD
- Self-retry respects maxAttempts limit
- All existing retry tests pass without modification
- All manifest schema tests pass without modification
</success_criteria>

<output>
After completion, create `.planning/quick/12-allow-for-the-retry-from-the-end-to-be-t/12-SUMMARY.md`
</output>

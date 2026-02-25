---
phase: quick-4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/agent/code-agent-runner.ts
  - src/agent/types.ts
  - tests/unit/code-agent-runner.test.ts
autonomous: true
requirements: [QUICK-4]

must_haves:
  truths:
    - "Pipeline returns MR_CREATED only when an MR URL was actually extracted from the MR bead output"
    - "Pipeline returns a distinct failure outcome when the MR bead runs but no MR URL is found"
    - "MR bead exit code is checked — non-zero exit triggers the failure path"
    - "Existing tests still pass and new cases cover the MR-failure scenarios"
  artifacts:
    - path: "src/agent/code-agent-runner.ts"
      provides: "MR bead result validation before returning MR_CREATED"
    - path: "tests/unit/code-agent-runner.test.ts"
      provides: "Tests covering MR bead failure scenarios"
  key_links:
    - from: "src/agent/code-agent-runner.ts"
      to: "src/agent/types.ts"
      via: "CodeAgentOutcome type"
      pattern: "MR_FAILED"
---

<objective>
Fix false-positive MR_CREATED outcome when MR bead fails to create a merge request.

Purpose: The pipeline currently returns `outcome: "MR_CREATED"` unconditionally after the MR bead
runs, even when `glab mr create` fails (non-zero exit or no URL in output). This happened in a real
run: code was pushed to a branch but no MR was created, yet the outcome said MR_CREATED.

The Confluence issue (log_mcp_config not set) is a configuration gap in workbench/nightshift.yaml,
not a code bug. It will be noted but not fixed in code — the user needs to uncomment and set the
`log_mcp_config` path in their config file.

Output: Patched pipeline that distinguishes MR creation success from failure.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/code-agent-runner.ts
@src/agent/types.ts
@src/agent/bead-runner.ts
@tests/unit/code-agent-runner.test.ts
@src/cli/commands/run.ts
@src/agent/code-agent.ts

<interfaces>
From src/agent/types.ts:
```typescript
export type CodeAgentOutcome = "MR_CREATED" | "NO_IMPROVEMENT" | "ABANDONED";

export interface CodeAgentRunResult {
  outcome: CodeAgentOutcome;
  mrUrl?: string;
  categoryUsed: string;
  isFallback: boolean;
  reason?: string;
  summary?: string;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface BeadResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  costUsd: number;
  timedOut: boolean;
}
```

From src/agent/code-agent.ts (deriveSummary — consumer of outcome):
```typescript
export function deriveSummary(result: CodeAgentRunResult): string {
  switch (result.outcome) {
    case "MR_CREATED":
      return result.mrUrl ?? "MR created";
    case "NO_IMPROVEMENT":
      return result.reason ?? "No improvement found";
    case "ABANDONED":
      return result.reason ?? "Abandoned after retries";
  }
}
```

From src/cli/commands/run.ts (consumer of outcome):
```typescript
console.log(info(`Outcome:  ${result.outcome}`));
if (result.mrUrl) {
  console.log(info(`MR URL:   ${result.mrUrl}`));
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add MR_FAILED outcome and validate MR bead result before returning MR_CREATED</name>
  <files>
    src/agent/types.ts
    src/agent/code-agent-runner.ts
    src/agent/code-agent.ts
    src/cli/commands/run.ts
  </files>
  <action>
**Root cause:** In `runCodeAgentPipeline` (code-agent-runner.ts lines 439-450), after the MR bead
runs, the pipeline unconditionally returns `outcome: "MR_CREATED"`. The `mrUrl` extraction in
`runMrBead` (lines 282-299) silently returns `undefined` when the URL regex doesn't match, but
the caller ignores this — it never checks whether the MR was actually created.

**Fix in src/agent/types.ts:**
Add `"MR_FAILED"` to the `CodeAgentOutcome` union type:
```typescript
export type CodeAgentOutcome = "MR_CREATED" | "MR_FAILED" | "NO_IMPROVEMENT" | "ABANDONED";
```

**Fix in src/agent/code-agent-runner.ts:**

1. Change `runMrBead` return type to also include the bead's exit code:
   Add `exitCode: number` to the `MrBeadResult` interface (around line 235).
   Return `exitCode: beadResult.exitCode` alongside the existing fields.

2. In `runCodeAgentPipeline`, after the `runMrBead` call (around line 439), add validation
   before returning:

```typescript
const mrResult = await runMrBead(ctx, category, guidance, actualCategory);
totalCost += mrResult.cost;
totalDuration += mrResult.duration;

// Validate MR was actually created (exit code 0 AND URL extracted)
if (mrResult.exitCode !== 0 || !mrResult.mrUrl) {
  ctx.logger.warn("MR bead completed but MR was not created", {
    exitCode: mrResult.exitCode,
    hasUrl: !!mrResult.mrUrl,
  });
  return {
    outcome: "MR_FAILED",
    mrUrl: mrResult.mrUrl,
    categoryUsed: actualCategory,
    isFallback,
    reason: mrResult.mrUrl
      ? undefined
      : `MR bead exited with code ${mrResult.exitCode} and no MR URL was found`,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
  };
}

return {
  outcome: "MR_CREATED",
  mrUrl: mrResult.mrUrl,
  // ... rest unchanged
};
```

**Fix in src/agent/code-agent.ts:**
Update `deriveSummary` to handle the new `MR_FAILED` case:
```typescript
case "MR_FAILED":
  return result.reason ?? "MR creation failed";
```

**Fix in src/cli/commands/run.ts:**
No code change needed — the existing `if (result.mrUrl)` guard already handles the case where mrUrl
is undefined. The outcome string will now correctly show `MR_FAILED` instead of `MR_CREATED`.
  </action>
  <verify>npx vitest run tests/unit/code-agent-runner.test.ts tests/unit/code-agent.test.ts --reporter=verbose 2>&1 | tail -30</verify>
  <done>
    - CodeAgentOutcome type includes "MR_FAILED"
    - Pipeline returns MR_FAILED when MR bead exits non-zero or no URL extracted
    - Pipeline returns MR_CREATED only when exit code is 0 AND mrUrl is present
    - deriveSummary handles MR_FAILED case
    - All existing tests pass (some test helpers may need MR URL in their mock to keep passing)
  </done>
</task>

<task type="auto">
  <name>Task 2: Add tests for MR bead failure scenarios</name>
  <files>tests/unit/code-agent-runner.test.ts</files>
  <action>
Add a new `describe("MR bead failure handling")` block in `tests/unit/code-agent-runner.test.ts`
with these test cases:

1. **"returns MR_FAILED when MR bead exits non-zero"** — Set up the pipeline to succeed through
   analyze+implement+verify, then have the MR bead return `exitCode: 1` with no URL. Assert
   `result.outcome === "MR_FAILED"` and `result.mrUrl` is undefined.

2. **"returns MR_FAILED when MR bead exits 0 but stdout contains no MR URL"** — MR bead returns
   `exitCode: 0` but the `result` field in the JSON output does not contain a merge_requests URL
   (e.g., `result: "Pushed branch but could not create MR"`). Assert `result.outcome === "MR_FAILED"`.

3. **"returns MR_CREATED only when MR bead exits 0 AND URL is present"** — Confirm the existing
   happy-path test still works (the existing test already covers this, but add an explicit assertion
   on exit code if not present).

4. **"MR_FAILED result includes reason explaining the failure"** — Assert that `result.reason`
   contains a meaningful message when MR_FAILED.

Use the existing `makeBeadResult`, `makeMrBeadResult`, and `makeAnalysisJson` helpers. For the
failure cases, create bead results with modified exit codes or stdout that lacks an MR URL.

Note: The existing `makeConfig` helper is missing the `log` prompt key in `prompts`. This does not
affect existing tests because the log bead runs in `code-agent.ts`, not in `code-agent-runner.ts`.
Do not change it — it is correct as-is for runner tests.
  </action>
  <verify>npx vitest run tests/unit/code-agent-runner.test.ts --reporter=verbose 2>&1 | tail -40</verify>
  <done>
    - At least 3 new test cases covering MR bead failure scenarios
    - All new tests pass green
    - All existing tests still pass (no regressions)
    - Tests verify both outcome and reason fields
  </done>
</task>

</tasks>

<verification>
```bash
# Full test suite passes
npx vitest run --reporter=verbose 2>&1 | tail -50

# TypeScript compiles cleanly
npx tsc --noEmit 2>&1

# Grep to confirm MR_FAILED is wired through
grep -rn "MR_FAILED" src/ tests/
```
</verification>

<success_criteria>
- `npx vitest run` passes with 0 failures
- `npx tsc --noEmit` exits 0
- `MR_FAILED` appears in types.ts, code-agent-runner.ts, code-agent.ts, and test file
- Pipeline no longer returns MR_CREATED when MR bead fails
</success_criteria>

<notes>
## Confluence issue (log_mcp_config not set)

This is NOT a code bug. The warning `log_mcp_config not set — skipping Confluence update` is
working as designed (see code-agent.ts line 74).

The root cause is that `workbench/nightshift.yaml` has `log_mcp_config` commented out (line 47-48).
To fix: uncomment and set the path to the MCP config JSON file that contains Atlassian credentials:

```yaml
code_agent:
  # ...
  log_mcp_config: /path/to/mcp-atlassian-config.json
```

This is a user configuration step, not a code change.
</notes>

<output>
After completion, create `.planning/quick/4-investigate-why-mr-was-not-created-despi/4-SUMMARY.md`
</output>

---
phase: quick-13
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/agent/engine.ts
  - src/daemon/orchestrator.ts
autonomous: true
must_haves:
  truths:
    - "A bead whose parsed output is an object with status FAILED halts the pipeline with FATAL status"
    - "Scheduled/recurring tasks skip bead close operations without errors"
  artifacts:
    - path: "src/agent/engine.ts"
      provides: "Semantic failure detection for bead outputs"
      contains: "status.*FAILED"
    - path: "src/daemon/orchestrator.ts"
      provides: "Origin-aware bead close guard"
      contains: "origin"
  key_links:
    - from: "src/agent/engine.ts"
      to: "engine-types.ts"
      via: "returns FATAL PipelineStatus on semantic failure"
      pattern: "status.*FATAL"
---

<objective>
Fix two bugs: (1) engine ignores bead output `status: "FAILED"` and marks pipeline SUCCESS, (2) orchestrator attempts bead close on recurring tasks that have no bead ID.

Purpose: Beads reporting semantic failure (preflight, submit) must halt the pipeline. Recurring tasks must skip bead operations.
Output: Patched engine.ts and orchestrator.ts
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/engine.ts
@src/agent/engine-types.ts
@src/daemon/orchestrator.ts
@src/core/types.ts

<interfaces>
From src/agent/engine-types.ts:
```typescript
export type BeadErrorCategory = "FATAL" | "TRANSIENT";
export type PipelineStatus = "SUCCESS" | "FATAL" | "TRANSIENT";
export interface BeadOutcome {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  error?: string;
}
export interface AgentRunResult<T = unknown> {
  runId: string;
  agentName: string;
  status: PipelineStatus;
  finalOutput: T | null;
  perBead: BeadOutcome[];
  totalDurationMs: number;
  failedBeadIndex?: number;
  errorCategory?: BeadErrorCategory;
  suggestedDelayMs?: number;
  error?: string;
  beadOutputs?: Record<string, unknown>;
}
```

From src/core/types.ts:
```typescript
export type TaskOrigin = "one-off" | "recurring";
export interface NightShiftTask {
  id: string;
  origin: TaskOrigin;
  // ...
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Detect semantic failure in bead output</name>
  <files>src/agent/engine.ts</files>
  <action>
In the engine's bead execution loop, AFTER schema validation succeeds (line 201: `validateBeadOutput`) and BEFORE the retry check (line 231), add a semantic failure check.

Insert the check between the current line 228 (`perBead.push SUCCESS`) and line 230 (the retry `if` block). The logic:

1. After `perBead.push({ name: bead.name, status: "SUCCESS", durationMs })` on line 228, add:

```typescript
// Detect semantic failure: bead output is valid JSON but indicates failure
if (
  typeof parsed === "object" &&
  parsed !== null &&
  "status" in parsed &&
  (parsed as Record<string, unknown>).status === "FAILED"
) {
  // Overwrite the SUCCESS we just pushed with FAILED
  perBead[perBead.length - 1] = { name: bead.name, status: "FAILED", durationMs, error: "Bead output status: FAILED" };

  // Mark remaining beads as SKIPPED
  for (let j = i + 1; j < manifest.beads.length; j++) {
    perBead.push({
      name: manifest.beads[j].name,
      status: "SKIPPED",
      durationMs: 0,
    });
  }

  this.logger.error("Bead reported semantic failure", {
    runId,
    bead: bead.name,
    outputPreview: rawOutput.slice(0, 500),
  });

  // Write bead output before returning
  await this.writeBeadOutput(runId, bead.name, rawOutput);
  await tmpDirManager.cleanup(tmpDir);

  const totalDurationMs = Date.now() - startTime;
  return {
    runId,
    agentName: manifest.name,
    status: "FATAL" as const,
    finalOutput: null,
    perBead,
    totalDurationMs,
    failedBeadIndex: i,
    errorCategory: "FATAL" as const,
    error: `Bead "${bead.name}" output status: FAILED`,
    beadOutputs,
  };
}
```

This check runs BEFORE the retry `passed === false` check. A bead with `status: "FAILED"` and no retry config gets a hard stop. A bead with both `status: "FAILED"` AND `passed: false` with retry config will never reach the retry check because this block returns early — which is correct: `status: "FAILED"` means the bead's job failed, not that it should retry.

IMPORTANT: Do NOT move or modify the existing retry logic (lines 231-276). The new block is inserted between line 228 and line 230, and returns early on semantic failure.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Engine detects `status: "FAILED"` in bead output, marks pipeline FATAL, skips remaining beads, returns early with error details. TypeScript compiles cleanly.</done>
</task>

<task type="auto">
  <name>Task 2: Guard bead close against recurring tasks</name>
  <files>src/daemon/orchestrator.ts</files>
  <action>
In `handleCompleted` method, wrap the bead operations block (lines 354-366) with an origin check. Replace:

```typescript
if (this.beads) {
  try {
    if (result.status !== "SUCCESS") {
      await this.beads.update(task.id, {
        labels: ["nightshift:failed"],
      });
    }
    await this.beads.close(task.id);
  } catch (err) {
    ...
  }
}
```

With:

```typescript
if (this.beads && task.origin !== "recurring") {
  try {
    if (result.status !== "SUCCESS") {
      await this.beads.update(task.id, {
        labels: ["nightshift:failed"],
      });
    }
    await this.beads.close(task.id);
  } catch (err) {
    this.logger.error(`Failed to close bead ${task.id}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

The only change is adding `&& task.origin !== "recurring"` to the outer `if`. Recurring tasks (from scheduler.ts) have NightShift-generated IDs (`ns-...`), not bead IDs, so `bd close` would always fail for them.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Orchestrator skips bead close/update for recurring tasks. Only one-off tasks (which originate from beads) attempt bead operations. TypeScript compiles cleanly.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Manual review: engine.ts has semantic failure check before retry logic
3. Manual review: orchestrator.ts guards bead close with origin check
</verification>

<success_criteria>
- Bead output with `{"status": "FAILED", ...}` causes pipeline to return FATAL status instead of SUCCESS
- Recurring tasks complete without attempting (and failing) bead close
- No TypeScript compilation errors
</success_criteria>

<output>
After completion, create `.planning/quick/13-investigate-preflight-submit-failure-not/13-SUMMARY.md`
</output>

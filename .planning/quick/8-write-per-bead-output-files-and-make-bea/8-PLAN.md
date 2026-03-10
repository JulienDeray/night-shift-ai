---
phase: quick-8
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/agent/engine.ts
  - src/agent/run-logger.ts
  - src/core/paths.ts
  - src/daemon/orchestrator.ts
  - src/cli/commands/_run-agent.ts
  - tests/unit/engine.test.ts
  - tests/unit/run-logger.test.ts
autonomous: true
requirements: [QUICK-8]

must_haves:
  truths:
    - "After each bead completes, its full raw output is written to .nightshift/logs/runs/<runId>/<beadName>.json"
    - "Daemon log messages include bead ID/name for each bead start/complete/fail event"
    - "Synchronous CLI execution also writes per-bead output files"
    - "Per-bead output files contain the full Claude JSON response (not truncated)"
  artifacts:
    - path: "src/agent/engine.ts"
      provides: "Per-bead file writing after each bead completes"
      contains: "writeBeadOutput"
    - path: "src/core/paths.ts"
      provides: "getRunOutputDir helper"
      exports: ["getRunOutputDir"]
    - path: "tests/unit/engine.test.ts"
      provides: "Tests verifying per-bead output files are written"
  key_links:
    - from: "src/agent/engine.ts"
      to: ".nightshift/logs/runs/<runId>/"
      via: "fs.writeFile after each bead succeeds or fails"
      pattern: "writeFile.*beadName"
---

<objective>
Write full per-bead output to individual files under `.nightshift/logs/runs/<runId>/` so users can inspect the complete Claude conversation for each bead. Also include bead name in all engine and daemon log messages for easier debugging.

Purpose: Currently bead output is truncated to 200 chars in logs and summaries, making it impossible to debug bead failures or inspect what Claude actually produced. Writing full output to files gives complete observability.

Output: Per-bead JSON files under `.nightshift/logs/runs/<runId>/`, bead name in all relevant log entries.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/engine.ts
@src/agent/engine-types.ts
@src/agent/run-logger.ts
@src/core/paths.ts
@src/core/logger.ts
@src/daemon/orchestrator.ts
@src/cli/commands/_run-agent.ts
@tests/unit/engine.test.ts

<interfaces>
From src/core/paths.ts:
```typescript
export function getLogsDir(base?: string): string;
export async function ensureDir(dirPath: string): Promise<void>;
```

From src/agent/engine-types.ts:
```typescript
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
  beadOutputs?: Record<string, unknown>;
  // ...
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add per-bead output file writing in AgentEngine and path helper</name>
  <files>src/core/paths.ts, src/agent/engine.ts, tests/unit/engine.test.ts</files>
  <behavior>
    - Test 1: After a successful bead execution, a file `<beadName>.json` exists under `.nightshift/logs/runs/<runId>/` containing the full raw stdout
    - Test 2: After a failed bead execution, the file is still written (with whatever output was captured before the error, or an error marker)
    - Test 3: The runs output directory is created automatically if it does not exist
    - Test 4: getRunOutputDir returns correct path `.nightshift/logs/runs/<runId>`
  </behavior>
  <action>
    1. In `src/core/paths.ts`: Add `getRunOutputDir(runId: string, base?: string): string` that returns `path.resolve(base, ".nightshift/logs/runs", runId)`. Export it.

    2. In `src/agent/engine.ts`:
       - Import `getRunOutputDir` and `ensureDir` from paths.
       - Add a private helper method `writeBeadOutput(runId: string, beadName: string, rawOutput: string, workDir: string)`:
         - Computes dir via `getRunOutputDir(runId, workDir)` — use the working directory's parent (the original project root) as base. Actually, the engine does not have access to the project root directly. Use `process.cwd()` as the base (consistent with how `getLogsDir` works with default base).
         - Calls `ensureDir(dir)` then `fs.writeFile(path.join(dir, beadName + ".json"), rawOutput, "utf-8")`.
         - Wrapped in try/catch — log warning on failure, never throw (best-effort, like JSONL logging).
       - In the success path of the bead loop (after `validateBeadOutput`), call `this.writeBeadOutput(runId, bead.name, rawOutput, ...)`.
       - In the catch block of the bead loop, if there is any partial rawOutput available, write it too. Since rawOutput is declared outside try but only assigned inside, initialize it to `""` and write only if non-empty.
       - Also include bead name explicitly in the "Bead started", "Bead completed", and "Bead failed" log messages' data objects (already present as `bead: bead.name` — good, no change needed there).

    3. In `tests/unit/engine.test.ts`: Add a describe block "per-bead output files" with tests that:
       - Mock `fs.writeFile` and `fs.mkdir` (or spy on them) to verify that after engine.run completes, writeFile was called with the expected path pattern and the full raw output string.
       - Verify the directory path includes the runId.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/engine.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>Per-bead output files are written to .nightshift/logs/runs/&lt;runId&gt;/&lt;beadName&gt;.json containing full raw output, with tests passing.</done>
</task>

<task type="auto">
  <name>Task 2: Include bead ID in daemon/CLI log messages and add runId to run log</name>
  <files>src/daemon/orchestrator.ts, src/cli/commands/_run-agent.ts, src/agent/run-logger.ts, tests/unit/run-logger.test.ts</files>
  <action>
    1. In `src/daemon/orchestrator.ts` `handleCompleted()`:
       - In the `Task completed` log line (line 336), add `runId: result.runId` to the log data object so the runId is visible in daemon logs, making it easy to correlate with the per-bead output directory.
       - Add `perBead` summary (bead names and statuses) to the log data, similar to what engine.ts already does in "Run summary".

    2. In `src/cli/commands/_run-agent.ts` `runAgentForeground()`:
       - After the "Agent run completed" / "Agent run FAILED" block, add a line printing the run output directory path: `console.log(info(\`Logs:     .nightshift/logs/runs/${result.runId}\`))` so the user knows where to find full bead output.

    3. In `src/agent/run-logger.ts`:
       - Add `run_id: string` field to the `RunLogEntry` interface.
       - This is a non-breaking addition since callers will need to provide it.

    4. In `src/daemon/orchestrator.ts` `handleCompleted()` JSONL logging block:
       - Pass `run_id: result.runId` to the `appendRunLog` call.

    5. In `src/cli/commands/_run-agent.ts`: The CLI path does not call `appendRunLog` currently — no change needed there (the engine already writes per-bead files from Task 1).

    6. Update `tests/unit/run-logger.test.ts` to include `run_id` in test entries.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/run-logger.test.ts tests/unit/orchestrator.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>Daemon logs include runId for task completion, CLI prints the logs directory path, run log JSONL entries include run_id field. All existing tests still pass.</done>
</task>

</tasks>

<verification>
```bash
cd /Users/julienderay/code/night-shift && npx vitest run --reporter=verbose 2>&1 | tail -50
```

Full test suite passes with no regressions.
</verification>

<success_criteria>
- Per-bead output files written to `.nightshift/logs/runs/<runId>/<beadName>.json` with full (non-truncated) raw output
- Bead name present in all engine log messages (already the case, verified)
- Daemon log messages include runId for correlation with output files
- CLI foreground execution prints the logs directory path
- RunLogEntry JSONL includes run_id field
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/8-write-per-bead-output-files-and-make-bea/8-01-SUMMARY.md`
</output>

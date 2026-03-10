# Quick Task 9: Fix bead-runner JSON envelope extraction

## Task
Fix `runBead()` to extract the `result` field from Claude CLI's JSON envelope instead of passing the raw envelope to output validation.

## Root Cause
`claude -p --output-format json` wraps agent output in a JSON object: `{"type":"result","result":"...actual text..."}`. The code was passing the entire envelope as `stdout`, so `validateBeadOutput()` couldn't find markdown JSON code blocks (they were escaped inside the JSON string).

## Fix
In `src/agent/bead-runner.ts:154`: change `stdout = spawnResult.stdout` → `stdout = parsed.result`.

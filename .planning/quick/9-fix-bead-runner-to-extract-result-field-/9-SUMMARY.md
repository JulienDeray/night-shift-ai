# Quick Task 9: Summary

## What changed

**`src/agent/bead-runner.ts`** — In `runBead()`, when the Claude CLI returns JSON output (`--output-format json`), the code now extracts `parsed.result` (the actual agent text) instead of returning `spawnResult.stdout` (the full JSON envelope). This fixes `validateBeadOutput()` failing with `BeadOutputMissingError` because markdown code blocks were JSON-escaped inside the envelope.

**`tests/unit/bead-runner.test.ts`** (new) — 7 unit tests covering:
- JSON envelope extraction (the regression case)
- Non-JSON stdout passthrough
- Non-zero exit code handling
- `buildBeadEnv` GITLAB_TOKEN forwarding
- `buildBeadArgs` flag construction

## Commit
5ca495d — `fix(bead-runner): extract result field from Claude CLI JSON envelope`

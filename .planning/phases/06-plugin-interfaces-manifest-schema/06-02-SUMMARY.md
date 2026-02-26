---
phase: 06-plugin-interfaces-manifest-schema
plan: "02"
subsystem: agent
tags: [manifest, loader, path-containment, inheritance, output-validation, zod]
dependency_graph:
  requires: ["06-01"]
  provides: ["manifest-loader"]
  affects: ["08-agent-engine"]
tech_stack:
  added: []
  patterns:
    - "z.fromJSONSchema() for JSON Schema to Zod compilation at load time"
    - "realpath() + path.sep-safe startsWith for symlink-safe path containment"
    - "All-errors-at-once Zod validation formatting (not fail-on-first)"
key_files:
  created:
    - src/agent/manifest-loader.ts
    - tests/unit/manifest-loader.test.ts
  modified: []
decisions:
  - "z.fromJSONSchema() called directly without (z as any) cast — confirmed exported from zod v4 TypeScript types"
  - "extractLastJsonBlock regex matches both ```json and ``` (no language tag) blocks"
  - "resolveBeadConfig(): agentDir resolved with realpath() before storing in LoadedManifest"
metrics:
  duration: "~20 min"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_added: 31
  completed_date: "2026-02-26"
---

# Phase 6 Plan 02: Manifest Loader Summary

**One-liner:** Manifest loader with symlink-safe path containment, full inheritance resolution (override/merge/replace per field), z.fromJSONSchema() compilation at load time, and BeadOutputMissing vs BeadContractViolation error distinction.

## What Was Built

`src/agent/manifest-loader.ts` — the single entry point converting a raw `manifest.yaml` into a fully resolved `LoadedManifest` ready for engine consumption.

**Functions exported:**
- `loadManifest(agentDir, agentsRoot)` — full pipeline: containment check → YAML read → Zod validate (all errors) → env resolve → inheritance → schema compile → return LoadedManifest
- `assertContained(targetPath, rootDir, label)` — symlink-safe path containment via `realpath()` + separator-safe `startsWith`; also exported for runtime engine use in Phase 8
- `extractLastJsonBlock(text)` — returns last JSON/plain code block content, or null
- `validateBeadOutput(rawOutput, compiledSchema, beadName)` — extracts last JSON block, parses, validates against compiled Zod schema; throws BeadOutputMissingError or BeadContractViolationError

**Internal functions:**
- `formatManifestErrors(issues, manifestPath)` — all Zod issues formatted with file path + field path
- `resolveEnvVars(entries, context)` — passthrough (from host, error if missing) and explicit ({name,value}, warn if secret-like name)
- `mergeEnv(agentEnv, beadEnv)` — Map-based merge with bead winning on collision
- `compileOutputSchema(jsonSchema, beadName)` — z.fromJSONSchema() wrapped in ManifestError catch
- `resolveBeadConfig(manifest, bead, agentEnv)` — applies inheritance rules per field

**Inheritance rules implemented:**
- `model`, `timeout`: bead ?? agent ?? default (override semantics)
- `allowedTools`: bead ?? agent ?? default (full replace — no merge)
- `env`: merge(agentEnv, beadEnv) — bead entries win on name collision

## Tests

31 tests in `tests/unit/manifest-loader.test.ts` covering:

1. **Path containment (MFST-02):** outside root rejected, symlink to outside rejected, inside root accepted, separator edge case (agents-extra vs agents/)
2. **Manifest loading:** valid loads, missing file, invalid YAML, all-errors reported at once
3. **Inheritance resolution (PLUG-04):** model/timeout override, allowedTools replace, env merge, env collision (bead wins)
4. **Env resolution:** passthrough from host, missing host var throws, secret-like name warns
5. **Output schema compilation (PLUG-03):** compiled at load time, invalid schema rejected at load time
6. **Bead output validation:** matching passes, schema violation, no block, last block used
7. **JSON block extraction:** single block, no blocks, last of multiple, no language tag, empty string, multi-line

## Deviations from Plan

**1. [Rule 1 - Auto-fix] z.fromJSONSchema used directly without cast**
- **Found during:** Task 1 implementation
- **Issue:** Plan notes `(z as any).fromJSONSchema` cast "needed because z.fromJSONSchema is not in base type definitions"
- **Fix:** Verified `fromJSONSchema` IS exported from `zod/v4/classic/external.d.ts` and re-exported from main `zod` package. Used `z.fromJSONSchema` directly without cast.
- **Files modified:** src/agent/manifest-loader.ts

Otherwise: plan executed exactly as written.

## Self-Check: PASSED

Files exist:
- FOUND: src/agent/manifest-loader.ts
- FOUND: tests/unit/manifest-loader.test.ts

Commits:
- FOUND: 12c351f (feat(06-02): implement manifest-loader)
- FOUND: 7711207 (test(06-02): comprehensive tests for manifest-loader)

Verification:
- `npx tsc --noEmit`: zero errors
- `npx vitest run tests/unit/manifest-loader.test.ts`: 31/31 tests passed

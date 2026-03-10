---
phase: quick-10
plan: "01"
subsystem: manifest-loader
tags: [nullable, output-schema, validation, manifest]
dependency_graph:
  requires: []
  provides: [nullable-field-support]
  affects: [manifest-loader, dev-tracking-agent]
tech_stack:
  added: []
  patterns: [preprocessNullable transformer, OpenAPI 3.0 nullable shorthand]
key_files:
  created: []
  modified:
    - src/agent/manifest-loader.ts
    - tests/unit/manifest-loader.test.ts
    - workbench-v2/agents/dev-tracking/manifest.yaml
    - docs/agents.md
decisions:
  - preprocessNullable is exported so it can be unit-tested directly
  - Returns new object (no mutation) to follow functional immutability
  - Strips nullable: false cleanly (removes key, no type change)
metrics:
  duration: 82s
  completed: "2026-03-10"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 10: Add Nullable Support for outputSchema in Agent Manifests Summary

**One-liner:** OpenAPI 3.0-style `nullable: true` shorthand that transforms to `type: ["string", "null"]` JSON Schema syntax before Zod compilation, fixing `BEAD_CONTRACT_VIOLATION` for optional null fields.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add preprocessNullable() and wire into compileOutputSchema | 568e279 | src/agent/manifest-loader.ts, tests/unit/manifest-loader.test.ts |
| 2 | Update dev-tracking manifest and document nullable support | e90a924 | workbench-v2/agents/dev-tracking/manifest.yaml, docs/agents.md |

## What Was Built

### Task 1: preprocessNullable() function

Added and exported `preprocessNullable()` to `src/agent/manifest-loader.ts`. The function:
- Accepts a JSON Schema object and returns a new object (no mutation)
- Transforms `{type: "string", nullable: true}` to `{type: ["string", "null"]}` and removes the `nullable` key
- Strips `nullable: false` without changing `type`
- Recursively processes `properties` (object schemas) and `items` (array schemas)

`compileOutputSchema()` now calls `preprocessNullable(jsonSchema)` before passing to `z.fromJSONSchema()`.

Added 15 new tests (8 unit for `preprocessNullable`, 2 integration confirming nullable acceptance/rejection at validation time). All 40 tests pass.

### Task 2: dev-tracking manifest and docs

- Added `nullable: true` to both `epic_key` and `note` properties in the `gather` bead's outputSchema in `workbench-v2/agents/dev-tracking/manifest.yaml`
- Added a "Nullable Fields" subsection to `docs/agents.md` (between "Minimal Output Schema" and "Environment Variables") explaining syntax, behavior, and the underlying JSON Schema array type equivalent

## Decisions Made

- **preprocessNullable exported**: Made it a named export so tests can import and verify transformation logic directly
- **Immutable transformation**: Returns a new object rather than mutating input, following functional style consistent with the rest of the codebase
- **nullable: false behavior**: Strips the key but does not add "null" to the type — semantically identical to not having nullable at all, clean output

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All 4 modified files exist. Both task commits (568e279, e90a924) present in git log.

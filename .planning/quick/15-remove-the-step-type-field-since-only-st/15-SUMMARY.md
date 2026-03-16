---
phase: quick-15
plan: 01
subsystem: docs
tags: [documentation, manifest, steps, template-variables]

requires: []
provides:
  - "docs/agents.md fully updated to match current codebase: step terminology, steps.* namespace, STEP_* error codes"
affects: [future-agent-authors, code-agent-docs]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - docs/agents.md

key-decisions:
  - "Removed type field entirely from all YAML examples in docs — matches manifest-schema.ts StepSchema which has no type field"
  - "Updated scaffold/init section to reflect single analyze step (no clone-stub.md), matching actual scaffold output"
  - "Removed GitCloneBeadPlugin references; clone step is now a regular step that clones via its prompt"

patterns-established: []

requirements-completed: ["QUICK-15"]

duration: 5min
completed: 2026-03-16
---

# Quick Task 15: Remove Step Type Field from docs/agents.md

**Complete bead-to-step terminology migration in docs/agents.md: removed type field, git-clone type, BEAD_* error codes, and beads.* template namespace**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-16T16:36:00Z
- **Completed:** 2026-03-16T16:37:10Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Renamed all "bead"/"beads" terminology to "step"/"steps" throughout the 940-line document
- Removed the `type` field from Step Fields table and all YAML code block examples
- Removed the "Bead Types" subsection describing `standard` and `git-clone` types
- Updated template variable namespace from `beads.*` to `steps.*` (12 occurrences)
- Updated error codes: `BEAD_CONTRACT_VIOLATION` -> `STEP_CONTRACT_VIOLATION`, `BEAD_OUTPUT_MISSING` -> `STEP_OUTPUT_MISSING`
- Updated top-level manifest field `beads:` -> `steps:` in all examples
- Updated scaffold/init section: single analyze step, removed clone-stub.md reference
- Removed `(git-clone type)` and `(standard type)` annotations from annotated pipeline section

## Task Commits

1. **Task 1: Update docs/agents.md** - `4ee2a6c` (docs)

## Files Created/Modified

- `/Users/julienderay/code/night-shift/docs/agents.md` - Complete bead-to-step terminology migration, type field removal, error code updates

## Decisions Made

None - followed plan as specified. All changes were mechanical find-and-replace plus removal of obsolete sections.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Documentation now fully matches the codebase. Any new agent authors reading docs/agents.md will see correct step terminology, correct template variable syntax (`steps.*`), and correct error code names (`STEP_*`).

---
*Phase: quick-15*
*Completed: 2026-03-16*

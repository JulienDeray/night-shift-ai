---
phase: quick-15
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/agents.md
autonomous: true
requirements: ["QUICK-15"]
must_haves:
  truths:
    - "docs/agents.md does not reference step type field (no type: standard, no type: git-clone)"
    - "docs/agents.md uses steps terminology consistently (not beads)"
    - "docs/agents.md template variable examples use steps.* namespace (not beads.*)"
    - "docs/agents.md error names match code: STEP_CONTRACT_VIOLATION, STEP_OUTPUT_MISSING"
  artifacts:
    - path: "docs/agents.md"
      provides: "Updated agent system reference documentation"
      contains: "steps:"
  key_links:
    - from: "docs/agents.md"
      to: "src/agent/manifest-schema.ts"
      via: "Documentation matches schema (no type field in StepSchema)"
      pattern: "Step Fields"
---

<objective>
Update docs/agents.md to remove all references to the step `type` field and the `git-clone` step type, and complete the bead-to-step terminology migration that was done in code (phase 14) but not in documentation.

Purpose: The code removed the `type` field from the manifest schema during v3.0 phase 14 (bead removal). The `git-clone` type was replaced by prompt-driven git cloning. However, `docs/agents.md` still references `type: standard`, `type: git-clone`, "bead" terminology, `beads.*` template syntax, and `BEAD_*` error codes throughout.

Output: A fully updated `docs/agents.md` that matches the current codebase.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/agents.md
@src/agent/manifest-schema.ts
@src/agent/manifest-types.ts
@src/agent/template.ts
@src/core/errors.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update docs/agents.md — remove type field, rename beads to steps, fix template syntax and error codes</name>
  <files>docs/agents.md</files>
  <action>
Update docs/agents.md with ALL of the following changes. Read the file first, then make a comprehensive edit pass.

**1. Rename "bead" to "step" throughout:**
- "bead" -> "step" and "beads" -> "steps" in all prose
- "Bead Reference" section heading -> "Step Reference"
- "Bead Types" section heading -> remove entirely (section at ~lines 145-149 about standard and git-clone types)
- "Bead Fields" -> "Step Fields"
- "Bead Name Uniqueness" -> "Step Name Uniqueness"
- "Bead Output References" -> "Step Output References"
- "Bead pipeline" -> "Step pipeline" in overview section (~line 7)
- All instances of "a bead" -> "a step", "each bead" -> "each step", "the bead" -> "the step", etc.

**2. Remove the `type` field entirely:**
- Remove the `type` row from the Step Fields table (line ~156: `| type | string | yes | -- | "standard" or "git-clone". |`)
- Remove ALL `type: standard` lines from YAML code blocks throughout the file
- Remove ALL `type: git-clone` lines from YAML code blocks throughout the file
- Remove the "Bead Types" subsection entirely (lines ~145-149 describing standard and git-clone)
- In the code-agent annotated reference, remove "(git-clone type)" and "(standard type)" annotations; the clone step is now just a regular step that clones via prompt instructions

**3. Update template variable namespace from beads.* to steps.*:**
- `{{beads.<name>.output.<field>}}` -> `{{steps.<name>.output.<field>}}`
- `{{beads.clone.output.repoDir}}` -> `{{steps.clone.output.repoDir}}`
- `{{beads.clone.output.handoffDir}}` -> `{{steps.clone.output.handoffDir}}`
- `{{beads.analyze.output.selected}}` -> `{{steps.analyze.output.selected}}`
- `{{beads.clone.rawOutput}}` -> `{{steps.clone.rawOutput}}`
- `beads.*` in prose about template variables -> `steps.*`

**4. Update error code names to match current code:**
- `BEAD_CONTRACT_VIOLATION` -> `STEP_CONTRACT_VIOLATION`
- `BEAD_OUTPUT_MISSING` -> `STEP_OUTPUT_MISSING`

**5. Update the top-level fields table:**
- The `beads` field row (line ~108) should be renamed to `steps` with description "Ordered list of pipeline stages. At least one step required."

**6. Update the manifest `beads:` key in YAML examples to `steps:`:**
- In the env vars merge rules example (~line 554), change `beads:` to `steps:`

**7. Update the scaffold/init section (~lines 598-603):**
- "two beads (clone + analyze)" -> describe what the current scaffold actually produces (a single analyze step, per the scaffold test)
- Remove mention of "clone-stub.md" and "git-clone bead prompt" from created files list
- Adjust to match: scaffold creates a manifest with steps (no type field), a single analyze step

**8. In the code-agent pipeline section:**
- Remove `(git-clone)` and `(standard)` type annotations from the numbered list (~lines 230-235)
- In the annotated clone step section (~line 729): remove "(`git-clone` type)" heading annotation, remove paragraph about GitCloneBeadPlugin, explain it as a step that handles cloning via its prompt
- For all other annotated steps: remove `(standard, ...)` from section headings, just use the model and relevant config info

**9. In the troubleshooting section:**
- "Duplicate bead names" -> "Duplicate step names"
- "X is not a preceding bead name" -> "X is not a preceding step name"

Keep all content accurate. Do NOT change the actual YAML schema fields (name, prompt, model, etc.) — only remove `type` lines and rename bead->step terminology.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && grep -c "bead\|beads\b" docs/agents.md | grep -q "^0$" && grep -c "type: standard\|type: git-clone\|BEAD_CONTRACT\|BEAD_OUTPUT" docs/agents.md | grep -q "^0$" && echo "PASS: No bead refs, no type field, no BEAD_ errors" || echo "FAIL: stale references remain"</automated>
  </verify>
  <done>docs/agents.md contains zero occurrences of: "bead"/"beads" (case-insensitive in context), "type: standard", "type: git-clone", "BEAD_CONTRACT_VIOLATION", "BEAD_OUTPUT_MISSING", "{{beads.*}}". All replaced with step terminology, steps.* namespace, and STEP_* error codes.</done>
</task>

</tasks>

<verification>
- `grep -icP '\bbead' docs/agents.md` returns 0
- `grep -c 'type: standard\|type: git-clone' docs/agents.md` returns 0
- `grep -c 'BEAD_' docs/agents.md` returns 0
- `grep -c '{{beads\.' docs/agents.md` returns 0
- `grep -c '{{steps\.' docs/agents.md` returns at least 1 (template variable examples use steps.* namespace)
- `grep -c 'STEP_CONTRACT_VIOLATION\|STEP_OUTPUT_MISSING' docs/agents.md` returns at least 1
- `npm test` still passes (docs changes should not break tests)
</verification>

<success_criteria>
- docs/agents.md is fully updated with zero bead terminology, zero type field references, correct steps.* template namespace, and correct STEP_* error codes
- Documentation matches the actual codebase (manifest-schema.ts has no type field, template.ts uses steps.* namespace, errors.ts uses STEP_* codes)
</success_criteria>

<output>
After completion, create `.planning/quick/15-remove-the-step-type-field-since-only-st/15-SUMMARY.md`
</output>

---
phase: quick-10
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/agent/manifest-loader.ts
  - tests/unit/manifest-loader.test.ts
  - workbench-v2/agents/dev-tracking/manifest.yaml
  - docs/agents.md
autonomous: true
requirements: [NULLABLE-SUPPORT]
must_haves:
  truths:
    - "Manifest fields with nullable: true accept null values at runtime"
    - "Manifest fields without nullable continue to reject null values"
    - "The dev-tracking agent's epic_key and note fields accept null"
    - "Documentation explains how to mark fields as nullable"
  artifacts:
    - path: "src/agent/manifest-loader.ts"
      provides: "preprocessNullable() function and integration in compileOutputSchema()"
      contains: "preprocessNullable"
    - path: "tests/unit/manifest-loader.test.ts"
      provides: "Tests for nullable preprocessing"
      contains: "preprocessNullable"
    - path: "workbench-v2/agents/dev-tracking/manifest.yaml"
      provides: "nullable: true on epic_key and note fields"
      contains: "nullable: true"
    - path: "docs/agents.md"
      provides: "Nullable fields documentation"
      contains: "nullable"
  key_links:
    - from: "src/agent/manifest-loader.ts"
      to: "z.fromJSONSchema()"
      via: "preprocessNullable() called before z.fromJSONSchema()"
      pattern: "preprocessNullable.*fromJSONSchema"
---

<objective>
Add nullable support for outputSchema fields in agent manifests.

Purpose: When agent beads produce null values for optional fields (like `epic_key`, `note`), the output schema validation currently fails with `BEAD_CONTRACT_VIOLATION` because JSON Schema `type: "string"` does not accept null. This adds a `nullable: true` shorthand that transforms to standard JSON Schema `type: ["string", "null"]` before compilation.

Output: Working nullable support in manifest-loader, updated dev-tracking manifest, tests, and documentation.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/agent/manifest-loader.ts
@tests/unit/manifest-loader.test.ts
@workbench-v2/agents/dev-tracking/manifest.yaml
@docs/agents.md

<interfaces>
<!-- Key functions and types the executor needs -->

From src/agent/manifest-loader.ts:
```typescript
// compileOutputSchema at line 106 — this is where preprocessNullable() must be called
function compileOutputSchema(
  jsonSchema: Record<string, unknown>,
  beadName: string,
): z.ZodTypeAny {
  try {
    return z.fromJSONSchema(jsonSchema) as z.ZodTypeAny;
  } catch (err) { ... }
}

// Exports used in tests:
export { assertContained, loadManifest, extractLastJsonBlock, validateBeadOutput }
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add preprocessNullable() and wire into compileOutputSchema</name>
  <files>src/agent/manifest-loader.ts, tests/unit/manifest-loader.test.ts</files>
  <behavior>
    - preprocessNullable transforms {type: "string", nullable: true} to {type: ["string", "null"]} and removes the nullable key
    - preprocessNullable transforms {type: "integer", nullable: true} to {type: ["integer", "null"]}
    - preprocessNullable recursively processes nested properties in objects
    - preprocessNullable recursively processes items in arrays
    - preprocessNullable leaves fields without nullable: true untouched
    - preprocessNullable leaves fields with nullable: false untouched (type stays as-is, nullable key removed)
    - A manifest loaded with nullable: true on a string field accepts null at validation time
    - A manifest loaded without nullable on a string field still rejects null at validation time
  </behavior>
  <action>
1. In `tests/unit/manifest-loader.test.ts`:
   - Export `preprocessNullable` from manifest-loader.ts (add to the import at line 9)
   - Add a new describe block "preprocessNullable — nullable field transformation" with unit tests for the function directly:
     - Transforms `{type: "string", nullable: true}` to `{type: ["string", "null"]}` (nullable key removed)
     - Transforms nested properties: `{type: "object", properties: {name: {type: "string", nullable: true}}}` processes recursively
     - Transforms array items: `{type: "array", items: {type: "number", nullable: true}}` processes items
     - Leaves `{type: "string"}` (no nullable key) untouched
     - Leaves `{type: "string", nullable: false}` as `{type: "string"}` (removes nullable key, does not convert type)
   - Add an integration test in the "output schema compilation" describe block:
     - A manifest with a bead whose outputSchema has `{type: "string", nullable: true}` on a property loads successfully and the compiled schema accepts both string and null values
     - A manifest with a bead whose outputSchema has `{type: "string"}` (no nullable) still rejects null

2. In `src/agent/manifest-loader.ts`:
   - Add and export a `preprocessNullable()` function that deeply traverses a JSON Schema object:
     - For any object with `nullable: true` and a string `type` field: replace `type` with `[type, "null"]` and delete the `nullable` key
     - For any object with `nullable: false`: just delete the `nullable` key (no type change)
     - Recurse into `properties` values if present
     - Recurse into `items` if present (handle both object and array forms)
     - Return a new object (do not mutate the input)
   - In `compileOutputSchema()`, call `preprocessNullable(jsonSchema)` before passing to `z.fromJSONSchema()`

Run tests after implementation to confirm RED then GREEN.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx vitest run tests/unit/manifest-loader.test.ts</automated>
  </verify>
  <done>preprocessNullable correctly transforms nullable: true to JSON Schema array type syntax; compileOutputSchema uses it; all existing and new tests pass</done>
</task>

<task type="auto">
  <name>Task 2: Update dev-tracking manifest and document nullable support</name>
  <files>workbench-v2/agents/dev-tracking/manifest.yaml, docs/agents.md</files>
  <action>
1. In `workbench-v2/agents/dev-tracking/manifest.yaml`:
   - In the `gather` bead's outputSchema, add `nullable: true` to the `epic_key` property (line ~88, under `epic_key: type: string`)
   - In the `gather` bead's outputSchema, add `nullable: true` to the `note` property (line ~84, under `note: type: string`)
   - These two fields are NOT in the `required` array, so they are optional. When provided, they may be null.

2. In `docs/agents.md`:
   - After the "Minimal Output Schema" subsection (around line 470, before "## Environment Variables"), add a new subsection:

```markdown
### Nullable Fields

To allow a field to accept `null` values, add `nullable: true` to the field definition:

```yaml
outputSchema:
  type: object
  properties:
    name:
      type: string
    epic_key:
      type: string
      nullable: true
  required:
    - name
```

With `nullable: true`, the field accepts both its declared type and `null`. Without it, `null` values cause a `BEAD_CONTRACT_VIOLATION`.

Under the hood, `nullable: true` is an OpenAPI 3.0-style shorthand. The manifest loader transforms it to standard JSON Schema `type: ["string", "null"]` before compilation. You can also use the array type syntax directly if you prefer:

```yaml
    epic_key:
      type:
        - string
        - "null"
```
```

  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && grep -c "nullable: true" workbench-v2/agents/dev-tracking/manifest.yaml | grep -q "2" && grep -c "nullable" docs/agents.md | grep -q "[1-9]" && echo "PASS"</automated>
  </verify>
  <done>dev-tracking manifest has nullable: true on epic_key and note; docs/agents.md has a "Nullable Fields" subsection explaining usage</done>
</task>

</tasks>

<verification>
1. All existing tests still pass: `npx vitest run tests/unit/manifest-loader.test.ts`
2. New nullable tests pass (both unit and integration)
3. dev-tracking manifest has nullable: true on epic_key and note
4. docs/agents.md contains nullable documentation
</verification>

<success_criteria>
- preprocessNullable() correctly transforms nullable: true to JSON Schema array type syntax
- compileOutputSchema() applies preprocessing before z.fromJSONSchema()
- The dev-tracking agent manifest uses nullable: true for epic_key and note
- Documentation explains nullable field syntax with examples
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/10-add-nullable-support-for-outputschema-in/10-SUMMARY.md`
</output>

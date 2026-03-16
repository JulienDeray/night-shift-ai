---
phase: quick-16
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/cli/index.ts
autonomous: true
requirements: [VERSION-BUMP, VERSION-DISPLAY]
must_haves:
  truths:
    - "package.json version field reads 3.0.0"
    - "Running nightshift --version prints 3.0.0"
    - "Version is sourced from package.json at runtime, not hardcoded in CLI code"
  artifacts:
    - path: "package.json"
      provides: "Version field set to 3.0.0"
      contains: '"version": "3.0.0"'
    - path: "src/cli/index.ts"
      provides: "Dynamic version reading from package.json"
      pattern: "createRequire|import.*package\\.json"
  key_links:
    - from: "src/cli/index.ts"
      to: "package.json"
      via: "createRequire import of package.json version field"
      pattern: "version"
---

<objective>
Bump the NPM version to 3.0.0 and make the CLI dynamically read the version from package.json so `nightshift --version` shows the correct version.

Purpose: The CLI currently hardcodes "0.1.0" while package.json says "2.0.0" — both are wrong for v3.0. Fix both and ensure they stay in sync permanently.
Output: Updated package.json (3.0.0) and src/cli/index.ts (dynamic version import).
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@package.json
@src/cli/index.ts
@tsconfig.json

<interfaces>
From src/cli/index.ts:
```typescript
import { Command } from "@commander-js/extra-typings";
export const program = new Command()
  .name("nightshift")
  .description("Queue tasks for autonomous AI agent execution during off-hours")
  .version("0.1.0");  // <-- hardcoded, must become dynamic
```

From tsconfig.json:
- `resolveJsonModule: true` is enabled, so JSON imports work
- `module: "Node16"` — ESM project, use createRequire for JSON imports to avoid TypeScript ESM JSON import issues
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bump package.json version and wire dynamic version into CLI</name>
  <files>package.json, src/cli/index.ts</files>
  <action>
1. In package.json, change `"version": "2.0.0"` to `"version": "3.0.0"`.

2. In src/cli/index.ts, read the version dynamically from package.json using Node's `createRequire`:
   - Add imports: `import { createRequire } from "node:module";`
   - Create require: `const require = createRequire(import.meta.url);`
   - Read version: `const { version } = require("../../package.json") as { version: string };`
   - Replace `.version("0.1.0")` with `.version(version)`

   Use createRequire rather than a direct ESM JSON import to avoid needing import assertions which have inconsistent TypeScript/Node support. The `../../package.json` path is correct because the compiled output lives in `dist/src/cli/index.js` relative to the project root.

   Do NOT use fs.readFileSync or URL-based resolution — createRequire is the idiomatic Node.js ESM approach for JSON imports.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsx bin/nightshift.ts --version | grep -q "3.0.0" && npm run build && node dist/bin/nightshift.js --version | grep -q "3.0.0" && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>
    - package.json version is "3.0.0"
    - `nightshift --version` outputs "3.0.0" in both dev (tsx) and compiled (dist) modes
    - No hardcoded version string remains in src/cli/index.ts
  </done>
</task>

</tasks>

<verification>
- `npx tsx bin/nightshift.ts --version` outputs "3.0.0"
- `npm run build && node dist/bin/nightshift.js --version` outputs "3.0.0"
- `npm run typecheck` passes
- `npm test` passes
- `grep '"version"' package.json` shows "3.0.0"
- No hardcoded version string in src/cli/index.ts (grep for `"0.1.0"` or `"2.0.0"` returns nothing)
</verification>

<success_criteria>
Running `nightshift --version` prints "3.0.0" sourced dynamically from package.json. The version is defined in exactly one place (package.json) and the CLI reads it at runtime.
</success_criteria>

<output>
After completion, create `.planning/quick/16-update-the-npm-version-to-3-and-make-it-/16-SUMMARY.md`
</output>

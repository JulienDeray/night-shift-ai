---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/utils/env-loader.ts
  - bin/nightshift.ts
  - src/daemon/index.ts
  - tests/unit/env-loader.test.ts
autonomous: true
requirements: [QUICK-3]

must_haves:
  truths:
    - "GITLAB_TOKEN from .env file is available in process.env when nightshift CLI commands run"
    - "GITLAB_TOKEN from .env file is available in process.env when daemon starts"
    - "Existing process.env values are NOT overridden by .env file values"
    - "Missing .env file is silently ignored (no error, no warning)"
  artifacts:
    - path: "src/utils/env-loader.ts"
      provides: "loadEnvFile utility"
      exports: ["loadEnvFile"]
    - path: "tests/unit/env-loader.test.ts"
      provides: "Unit tests for env-loader"
      min_lines: 40
  key_links:
    - from: "bin/nightshift.ts"
      to: "src/utils/env-loader.ts"
      via: "import and call at top of file before program.parse()"
      pattern: "loadEnvFile"
    - from: "src/daemon/index.ts"
      to: "src/utils/env-loader.ts"
      via: "import and call at top of file before Orchestrator creation"
      pattern: "loadEnvFile"
---

<objective>
Load environment variables from a `.env` file (co-located with `nightshift.yaml`) into `process.env` at startup, so that `GITLAB_TOKEN` and any other secrets can live in a `.env` file rather than requiring shell-level `export` statements.

Purpose: Users currently must `export GITLAB_TOKEN=...` in their shell before running nightshift. A `.env` file next to `nightshift.yaml` is a more ergonomic and standard pattern for local secrets.

Output: `src/utils/env-loader.ts` utility called from both entrypoints, plus unit tests.
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/utils/env-loader.ts (new file)
@bin/nightshift.ts
@src/daemon/index.ts
@src/core/paths.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create env-loader utility and tests</name>
  <files>src/utils/env-loader.ts, tests/unit/env-loader.test.ts</files>
  <action>
Create `src/utils/env-loader.ts` with a single exported function `loadEnvFile(base?: string): void`:

1. Resolve the `.env` file path as `path.resolve(base ?? process.cwd(), ".env")`
2. Use `fs.readFileSync` (synchronous -- this runs once at startup before any async work)
3. If the file does not exist, return silently (wrap in try/catch, catch ENOENT and return)
4. Parse the file content line by line:
   - Skip empty lines and lines starting with `#` (comments)
   - Match lines with pattern: `KEY=VALUE` (use regex `/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/`)
   - Trim the value; if value is wrapped in single or double quotes, strip the outer quotes
   - **Only set `process.env[key]` if it is NOT already defined** (existing env vars take precedence -- this is critical for the security model where shell-exported GITLAB_TOKEN must win)
5. Do NOT use any external dependency (no `dotenv`). The parser only needs to handle `KEY=VALUE`, `KEY="VALUE"`, `KEY='VALUE'`, comments, and blank lines. No multiline values, no variable interpolation, no export prefix.

Create `tests/unit/env-loader.test.ts`:
- Test: parses KEY=VALUE lines and sets process.env
- Test: skips comment lines (starting with #)
- Test: skips blank lines
- Test: strips double quotes from values
- Test: strips single quotes from values
- Test: does NOT override existing process.env values (critical security test)
- Test: silently ignores missing .env file (no throw)
- Test: handles KEY= (empty value)

Use `vi.spyOn(fs, "readFileSync")` to mock file reads in tests. Clean up any process.env keys set during tests using beforeEach/afterEach.
  </action>
  <verify>
    npx vitest run tests/unit/env-loader.test.ts
  </verify>
  <done>All env-loader tests pass. Utility correctly loads .env without overriding existing vars and silently handles missing files.</done>
</task>

<task type="auto">
  <name>Task 2: Wire env-loader into CLI and daemon entrypoints</name>
  <files>bin/nightshift.ts, src/daemon/index.ts</files>
  <action>
**bin/nightshift.ts** -- Add `loadEnvFile()` call BEFORE `program.parse()`:

```typescript
#!/usr/bin/env node

import { loadEnvFile } from "../src/utils/env-loader.js";
import { program } from "../src/cli/index.js";

loadEnvFile();
program.parse();
```

The call uses the default `process.cwd()` base, which is the same directory where `nightshift.yaml` lives, which is where users should place their `.env` file.

**src/daemon/index.ts** -- Add `loadEnvFile()` call BEFORE Orchestrator creation:

```typescript
import { loadEnvFile } from "../utils/env-loader.js";
import { Orchestrator } from "./orchestrator.js";

loadEnvFile();

const orchestrator = new Orchestrator();
// ... rest unchanged
```

The daemon is spawned with `cwd: process.cwd()` from `start.ts` line 33, so `process.cwd()` in the daemon process will be the nightshift config directory -- same as the CLI.

Do NOT add `.env` to `.gitignore` -- `workbench/*` already covers the workbench directory. But DO add a top-level `.env` entry to `.gitignore` since users may create `.env` at project root. Check if `.env` is already covered; if not, add it.

Verify that the existing `npm run build` (tsc) still compiles cleanly after the changes.
  </action>
  <verify>
    npx tsc --noEmit && npx vitest run tests/unit/env-loader.test.ts
  </verify>
  <done>Both entrypoints call loadEnvFile() before any other initialization. TypeScript compiles cleanly. .env is gitignored.</done>
</task>

</tasks>

<verification>
- `npx vitest run tests/unit/env-loader.test.ts` -- all tests pass
- `npx tsc --noEmit` -- no compilation errors
- `npx vitest run` -- full test suite still passes (no regressions)
</verification>

<success_criteria>
- loadEnvFile utility exists with zero external dependencies
- Both entrypoints (CLI and daemon) call loadEnvFile() before any business logic
- Existing process.env values are never overridden (security invariant preserved)
- Missing .env file causes no error or warning
- .env is gitignored
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/3-load-gitlab-token-from-env-file-if-avail/3-SUMMARY.md`
</output>

---
phase: quick-11
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/commands/start.ts
autonomous: true
requirements: [QUICK-11]
must_haves:
  truths:
    - "Invalid manifests are caught before the daemon is spawned, with clear error output"
    - "After spawning, the start command waits briefly and checks the process is still alive before reporting success"
    - "If the daemon crashes immediately after spawn, the user sees an error instead of a success message"
  artifacts:
    - path: "src/cli/commands/start.ts"
      provides: "Pre-spawn manifest validation and post-spawn liveness check"
  key_links:
    - from: "src/cli/commands/start.ts"
      to: "src/daemon/orchestrator.ts"
      via: "reuses validateAgentsAtStartup"
      pattern: "validateAgentsAtStartup"
---

<objective>
Add two reliability improvements to the `nightshift start` command:
1. Run manifest validation (reusing the existing `validateAgentsAtStartup`) in the CLI process BEFORE spawning the daemon, so invalid manifests produce immediate, visible errors instead of silent daemon crashes.
2. After spawning the daemon, wait a short delay (~1s) then check if the child process is still alive before reporting success.

Purpose: Prevent the confusing UX where `start` reports success but the daemon immediately crashes due to manifest errors.
Output: Updated `src/cli/commands/start.ts`
</objective>

<execution_context>
@/Users/julienderay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/julienderay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/cli/commands/start.ts
@src/daemon/orchestrator.ts (validateAgentsAtStartup function — lines 29-107)
@src/core/config.ts (loadConfig, getConfigPath)
@src/core/paths.ts (getConfigPath)
@src/daemon/health.ts (readDaemonState, isDaemonRunning)
</context>

<interfaces>
<!-- Key functions the executor needs -->

From src/daemon/orchestrator.ts:
```typescript
export async function validateAgentsAtStartup(
  config: NightShiftConfig,
  configDir: string,
): Promise<void>;
// Throws ConfigError if any agent manifest is invalid
// Is a no-op when config.agents is empty
```

From src/core/config.ts:
```typescript
export async function loadConfig(base?: string): Promise<NightShiftConfig>;
```

From src/core/paths.ts:
```typescript
export function getConfigPath(base?: string): string;
```

From src/cli/formatters.ts:
```typescript
export function success(msg: string): string;
export function error(msg: string): string;
export function warn(msg: string): string;
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Add pre-spawn manifest validation and post-spawn liveness check to start command</name>
  <files>src/cli/commands/start.ts</files>
  <action>
Modify `src/cli/commands/start.ts` to add two features:

**1. Pre-spawn manifest validation (after loadConfig, before spawn):**
- Import `validateAgentsAtStartup` from `../../daemon/orchestrator.js`
- Import `getConfigPath` from `../../core/paths.js`
- Import `path` (already imported)
- After the existing `loadConfig()` call and "already running" check, call `validateAgentsAtStartup(config, path.dirname(getConfigPath()))`.
- This reuses the exact same validation the daemon runs internally, but now runs it in the CLI process where errors are visible.
- If it throws, the error will be caught by the existing try/catch and printed via `console.error(error(...))`.
- Add a console.log line before validation like: `console.log('Validating agent manifests...');` — but only if `config.agents.length > 0` to avoid noise for configs with no agents.

**2. Post-spawn liveness check (after child.unref()):**
- After obtaining the PID and before printing the success message, add a ~1 second delay using `await new Promise(resolve => setTimeout(resolve, 1000))`.
- Then check if the process is still alive using a try/catch around `process.kill(pid, 0)`. Signal 0 does not kill the process, it just checks existence.
- If the process is NOT alive (the kill throws), print an error message: "Daemon process exited immediately after starting. Check logs for details." and set `process.exitCode = 1` and return.
- If the process IS alive, proceed with the existing success output.

Do NOT remove the existing `validateAgentsAtStartup` call inside `orchestrator.start()` — it must remain as a safety net for the daemon process itself.
  </action>
  <verify>
    <automated>cd /Users/julienderay/code/night-shift && npx tsc --noEmit</automated>
  </verify>
  <done>
- `nightshift start` with an invalid agent manifest prints the validation error and exits with code 1 without spawning the daemon
- `nightshift start` with valid manifests spawns the daemon, waits ~1s, confirms it is still alive, then prints success
- `nightshift start` with no agents configured skips validation silently and proceeds normally
- If the daemon crashes within the first second, the start command reports an error instead of success
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no type errors
2. Manual test: Run `nightshift start` with a valid config — should see success after ~1s delay
3. Manual test: Introduce a deliberate manifest error (e.g., invalid YAML in an agent's manifest.yaml) — `nightshift start` should print the error and NOT spawn the daemon
</verification>

<success_criteria>
- TypeScript compiles without errors
- Invalid manifests produce immediate CLI-visible errors before daemon spawn
- Post-spawn liveness check detects immediate daemon crashes within ~1 second
</success_criteria>

<output>
After completion, create `.planning/quick/11-add-manifest-validation-before-start-and/11-SUMMARY.md`
</output>

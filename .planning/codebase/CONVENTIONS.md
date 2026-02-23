# Coding Conventions

**Analysis Date:** 2026-02-23

## Naming Patterns

**Files:**
- camelCase for utility modules: `scheduler.ts`, `template.ts`, `reporter.ts`
- camelCase for class/service files: `logger.ts`, `config.ts`, `formatter.ts`
- camelCase for command files: `init.ts`, `submit.ts`, `status.ts`
- Use `.test.ts` suffix for test files in dedicated `tests/` directory

**Functions:**
- camelCase for all functions: `renderTemplate()`, `loadConfig()`, `parseTimeout()`, `evaluateSchedules()`
- Use descriptive verb-noun combinations: `parseTimeout()`, `formatDuration()`, `generateReport()`
- Async functions use camelCase like any other function: `loadState()`, `evaluateSchedules()`, `createTask()`

**Variables:**
- camelCase for all variables: `tmpDir`, `taskId`, `lastRun`, `pollIntervalMs`
- Constants use UPPER_SNAKE_CASE: `LOG_LEVEL_PRIORITY`, `NIGHTSHIFT_DIR`
- Private class members use camelCase with underscore prefix discouraged (TypeScript `private` keyword used instead)

**Types:**
- PascalCase for interfaces and type aliases: `NightShiftTask`, `AgentExecutionResult`, `RecurringTaskConfig`, `SchedulerState`, `LogEntry`
- Use `type` for unions/primitives: `type TaskOrigin = "one-off" | "recurring"`
- Use `interface` for object shapes: `interface NightShiftTask { ... }`

## Code Style

**Formatting:**
- No explicit linter/formatter configured (not detected in repo)
- 2-space indentation (observed throughout codebase)
- Use trailing commas in multiline structures
- Line wrapping at reasonable lengths (no strict enforcer, but ~80-100 chars observed)

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- `forceConsistentCasingInFileNames: true` - enforces case-sensitive imports
- `esModuleInterop: true` - allows default imports from CommonJS modules

## Import Organization

**Order:**
1. Node.js built-in modules: `import fs from "node:fs/promises"`
2. External dependencies: `import { z } from "zod"`, `import { Cron } from "croner"`
3. Internal modules from parent: `import { getConfigPath } from "../../core/paths.js"`
4. Type imports: `import type { NightShiftConfig } from "../../core/types.js"`

**Path Aliases:**
- No path aliases configured
- Use relative imports: `"../../core/config.js"`, `"../../src/utils/fs.js"`
- Always include file extensions in imports: `.js` suffix (ESM)

**Module Exports:**
- Named exports for functions and types: `export function loadConfig(...)`, `export type TaskStatus = ...`
- Default export only for Command instances: `export const initCommand = new Command(...)`
- Keep exports at module level, avoid re-exporting from index files

## Error Handling

**Patterns:**
- Use custom error classes extending `NightShiftError` base class
- Specific error types for different domains:
  - `ConfigError` for configuration issues
  - `DaemonError` for daemon-related issues
  - `BeadsError` for Beads integration issues
  - `AgentExecutionError` for task execution failures
  - `TimeoutError` for timeout scenarios
- Include context in error messages: `new ConfigError("Config file not found: ${configPath}")`
- When catching unknown errors, check type: `err instanceof Error ? err.message : String(err)`
- Async operations use try/catch blocks in main flow, return `{valid: false, error: ...}` for validation functions

**Example:**
```typescript
try {
  content = await fs.readFile(configPath, "utf-8");
} catch {
  throw new ConfigError(`Config file not found: ${configPath}`);
}
```

## Logging

**Framework:** Custom `Logger` class in `src/core/logger.ts` (not using Winston, Pino, etc.)

**Patterns:**
- Instantiate via static factory methods:
  - `Logger.createCliLogger(verbose)` - for CLI output
  - `Logger.createDaemonLogger(base)` - for daemon file logging
- Log levels: `debug`, `info`, `warn`, `error`
- Always pass message string, optionally pass data object: `logger.info("Task created", { taskId, name })`
- Do NOT use console.log directly in application code; use logger instead
- CLI commands use `console.log()` with formatter helpers: `console.log(success("..."))`, `console.log(error("..."))`

**Example:**
```typescript
logger.info("Recurring task triggered", { schedule: recurring.schedule });
logger.error(`Failed to create bead`, { error: err.message });
```

## Comments

**When to Comment:**
- Document non-obvious business logic or cron schedule interpretation
- Explain workarounds or constraints (e.g., "lookback 5 minutes to detect first run" in scheduler)
- Do NOT comment obvious code: `const tasks: NightShiftTask[] = []` needs no comment

**JSDoc/TSDoc:**
- Not consistently used; TypeScript types provide sufficient documentation
- When used, keep brief: inline doc strings only for public APIs
- Example: Comments in scheduler explain cron lookback logic at point of complexity

**Example (from scheduler.ts):**
```typescript
// Never run before - find the most recent scheduled trigger by
// computing nextRun from a point in the past. If that trigger falls
// between then and now, the task is due.
const lookback = new Date(now.getTime() - 5 * 60 * 1000);
```

## Function Design

**Size:**
- Typical functions are 5-30 lines
- Utility functions are kept small: `renderTemplate()` is 22 lines, `parseTimeout()` is 18 lines
- Private helper methods like `isDue()`, `createTask()` can be larger to maintain cohesion

**Parameters:**
- Use positional parameters for required arguments: `loadConfig(base: string)`
- Use options object for optional/multiple config: `constructor(options?: { logFile?: string; minLevel?: LogLevel; stdout?: boolean })`
- Prefer typed objects over numerous parameters: `spawnWithTimeout(command, args, options)` not `spawnWithTimeout(cmd, args, timeout, cwd, env, taskId)`

**Return Values:**
- Explicit types always: `Promise<NightShiftConfig>`, `Promise<NightShiftTask[]>`, not implicit `any`
- Use discriminated unions for result objects: `{ valid: true, config } | { valid: false, error }`
- Async functions return Promise-wrapped types: `async function loadConfig(): Promise<NightShiftConfig>`

**Example:**
```typescript
export async function validateConfig(
  base: string = process.cwd(),
): Promise<{ valid: boolean; config?: NightShiftConfig; error?: string }> {
  try {
    const config = await loadConfig(base);
    return { valid: true, config };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

## Module Design

**Exports:**
- Each module exports its primary concern: `config.ts` exports `loadConfig()`, `validateConfig()`, `getDefaultConfigYaml()`
- Private functions not prefixed with underscore; use `private` keyword in classes
- Classes are stateful and exported as-is: `export class Scheduler`, `export class Logger`

**Barrel Files:**
- No barrel/index files (`index.ts`) re-exporting from subdirectories
- Direct imports from modules: `import { loadConfig } from "../../core/config.js"`, not from `index.js`

**Example Module Structure:**
```
src/core/
  ├── types.ts       (exports: types and interfaces)
  ├── config.ts      (exports: loadConfig, validateConfig, getDefaultConfigYaml)
  ├── logger.ts      (exports: Logger class, LogLevel type)
  └── errors.ts      (exports: custom error classes)
```

---

*Convention analysis: 2026-02-23*

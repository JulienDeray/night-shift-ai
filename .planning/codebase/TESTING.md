# Testing Patterns

**Analysis Date:** 2026-02-23

## Test Framework

**Runner:**
- Vitest 3.1.0
- Config: `vitest.config.ts`
- Test timeout: 30 seconds default

**Assertion Library:**
- Vitest built-in assertions via `expect()` from `vitest`

**Run Commands:**
```bash
npm run test              # Run all tests (one-off)
npm run test:watch       # Watch mode
npm run typecheck        # TypeScript type checking
```

## Test File Organization

**Location:**
- Tests co-located in `tests/` directory (not alongside source)
- Organized by test type: `tests/unit/`, `tests/integration/`

**Naming:**
- `*.test.ts` suffix: `config.test.ts`, `scheduler.test.ts`, `template.test.ts`

**Structure:**
```
tests/
├── unit/              # Unit tests for individual modules
│   ├── config.test.ts
│   ├── scheduler.test.ts
│   ├── template.test.ts
│   ├── process.test.ts
│   └── ...
└── integration/       # End-to-end CLI integration tests
    ├── submit.test.ts
    ├── init-and-config.test.ts
    ├── schedule.test.ts
    └── ...
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("moduleName", () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(async () => {
    // Setup: create temp directory, initialize resources
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-test-"));
    logger = Logger.createCliLogger(false);
  });

  afterEach(async () => {
    // Teardown: clean up temp files and resources
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("describes what the function does", async () => {
    // Arrange: set up test data
    const config = { /* test config */ };

    // Act: execute the behavior being tested
    const result = await loadConfig(tmpDir);

    // Assert: verify expectations
    expect(result.valid).toBe(true);
  });
});
```

**Patterns:**
- Setup in `beforeEach()`: temporary directories, mock data, logger instances
- Teardown in `afterEach()`: remove temp files, reset process.cwd patching
- Describe-It nesting: one top-level `describe()` per module, multiple `it()` per behavior
- Async test support: `async () => { ... }` with `await` for async operations

## Mocking

**Framework:** Vitest `vi` utilities for mocking

**Patterns:**
```typescript
// Mock process.cwd for tests that need different working directories
const origCwd = process.cwd;
process.cwd = () => tmpDir;
try {
  // test code
} finally {
  process.cwd = origCwd;
}

// Use vi.spyOn for spying on method calls (advanced tests)
// Avoid vi.mock() - use dependency injection instead
```

**What to Mock:**
- Process environment when testing config loading: wrap tmpDir operations
- Filesystem operations: use real `fs` with temp directories, not mocks (see rationale below)
- Process methods when working directory matters: temporarily replace `process.cwd`

**What NOT to Mock:**
- File system operations - use real temp directories instead (provides confidence in actual I/O)
- Logger - instantiate real logger in tests; logging is part of observable behavior
- Custom error classes - test with real errors; error handling is core behavior
- Zod validation - test with real schema; config validation is critical path

**Rationale:** Mocking filesystem or validation introduces test fragility. Real temp directories are fast and reliable; testing actual file I/O catches bugs that mocks would miss.

## Fixtures and Factories

**Test Data:**
```typescript
// Factory function for creating test configs
function makeConfig(overrides?: Partial<NightShiftConfig>): NightShiftConfig {
  return {
    workspace: "./workspace",
    inbox: "./inbox",
    maxConcurrent: 2,
    defaultTimeout: "30m",
    beads: { enabled: false }, // disable beads for unit tests
    daemon: {
      pollIntervalMs: 30000,
      heartbeatIntervalMs: 10000,
      logRetentionDays: 30,
    },
    recurring: [],
    oneOffDefaults: { timeout: "30m" },
    ...overrides,
  };
}

// Usage in tests:
const config = makeConfig({ maxConcurrent: 4, recurring: [...] });
```

**Location:**
- Factories defined inline in test files: `tests/unit/scheduler.test.ts`
- Temporary directories created fresh in `beforeEach()`
- Test YAML configs written to temp dir: `await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml)`

## Coverage

**Requirements:** Not enforced (no coverage threshold in vitest config)

**View Coverage:**
- Not configured; no coverage reporting command
- Coverage analysis deferred to future tooling

## Test Types

**Unit Tests:**
- `tests/unit/` directory
- Test individual functions/classes in isolation
- Mock minimal dependencies; use real temp directories for filesystem
- Examples: `config.test.ts` (Zod validation), `template.test.ts` (string rendering), `process.test.ts` (timeout parsing)
- Scope: Single module's public API
- Setup: Create temp dirs, instantiate classes, no CLI subprocess calls

**Integration Tests:**
- `tests/integration/` directory
- Test CLI commands end-to-end via subprocess
- Spawn actual CLI process: `spawnWithTimeout("npx", ["tsx", bin, ...args])`
- Verify file system state after CLI execution
- Examples: `submit.test.ts` (CLI queuing), `init-and-config.test.ts` (init flow)
- Scope: Full command execution path from user input to output
- Setup: Create temp workspace, write config, run CLI, read resulting files

**E2E Tests:**
- Not present in this codebase
- No Playwright/Cypress/etc configuration
- Integration tests (CLI subprocess tests) serve E2E purpose

## Common Patterns

**Async Testing:**
```typescript
it("loads config asynchronously", async () => {
  await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);
  const config = await loadConfig(tmpDir);
  expect(config.workspace).toBe("./workspace");
});

// Timeout handling:
// Tests automatically fail if they take >30s (vitest.config.ts testTimeout)
```

**Error Testing:**
```typescript
// Testing thrown errors
it("throws ConfigError on missing file", async () => {
  await expect(loadConfig(tmpDir)).rejects.toThrow("Config file not found");
});

// Testing error details
it("includes path in error message", async () => {
  try {
    await loadConfig(tmpDir);
    expect.fail("should have thrown");
  } catch (err) {
    expect(err instanceof ConfigError).toBe(true);
    expect(err.message).toContain(configPath);
  }
});

// Testing validation error cases
it("validates config schema", async () => {
  const yaml = `max_concurrent: -1`; // invalid: must be positive
  await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), yaml);
  await expect(loadConfig(tmpDir)).rejects.toThrow("Invalid config");
});
```

**CLI Integration Testing:**
```typescript
it("creates a task file in the queue directory", async () => {
  // Arrange: set up CLI environment
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-submit-"));
  await run(["init"]); // initialize config/dirs

  // Act: execute CLI command
  const res = await run(["submit", "Say hello world"]);

  // Assert: verify CLI exit and output
  expect(res.exitCode).toBe(0);
  expect(res.stdout).toContain("Task queued");

  // Assert: verify side effects (filesystem state)
  const tasks = await readQueuedTasks();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].prompt).toBe("Say hello world");
});

// Helper for running CLI in tests:
function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { result } = spawnWithTimeout("npx", ["tsx", bin, ...args], {
    timeoutMs: 15000,
    cwd: tmpDir,
  });
  return result;
}
```

## Test Coverage Snapshot

**Current test files:**
- Unit: `process.test.ts`, `scheduler.test.ts`, `reporter.test.ts`, `mapper.test.ts`, `template.test.ts`, `agent-runner.test.ts`, `orchestrator.test.ts`, `config.test.ts`, `agent-pool.test.ts`, `health.test.ts`
- Integration: `inbox.test.ts`, `schedule.test.ts`, `submit.test.ts`, `status.test.ts`, `init-and-config.test.ts`

**Well-tested areas:**
- Configuration loading and validation
- Scheduler cron evaluation and task creation
- Template rendering with variables
- CLI command integration (submit, init)
- Process spawning with timeout

**Areas without explicit tests:**
- Beads integration (disabled in tests)
- Daemon process lifecycle
- Agent execution and result mapping
- Error reporting and inbox management

---

*Testing analysis: 2026-02-23*

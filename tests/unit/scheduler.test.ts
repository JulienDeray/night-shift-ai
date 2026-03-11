import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import { readJsonFile } from "../../src/utils/fs.js";
import type { NightShiftConfig } from "../../src/core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<NightShiftConfig>): NightShiftConfig {
  return {
    workspace: "./workspace",
    inbox: "./inbox",
    maxConcurrent: 2,
    defaultTimeout: "30m",
    beads: { enabled: false },
    daemon: {
      pollIntervalMs: 30000,
      heartbeatIntervalMs: 10000,
      logRetentionDays: 30,
    },
    agentsDir: "./agents",
    agents: [],
    schedule: [],
    oneOffDefaults: { timeout: "30m" },
    ...overrides,
  };
}

/**
 * Seed a fresh scheduler so all schedule keys get their initial lastRuns entry.
 * Returns the seeding tasks (should be empty after the fix).
 */
async function seedScheduler(scheduler: Scheduler): Promise<void> {
  const tasks = await scheduler.evaluateSchedules();
  expect(tasks).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Scheduler.evaluateSchedules()", () => {
  let tmpDir: string;
  let logger: Logger;
  let origCwd: typeof process.cwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-sched-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift"), { recursive: true });
    logger = Logger.createCliLogger(false);

    // Redirect process.cwd() so saveState/loadState write to tmpDir
    origCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(async () => {
    process.cwd = origCwd;
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. Empty schedule returns []
  // -------------------------------------------------------------------------

  it("returns empty when no schedules configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const scheduler = new Scheduler(makeConfig({ agents: [], schedule: [] }), logger);
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Disabled entries are skipped
  // -------------------------------------------------------------------------

  it("returns empty when all schedules disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: false }],
    });

    const scheduler = new Scheduler(config, logger);
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3. Creates task for a due schedule entry (after seeding)
  // -------------------------------------------------------------------------

  it("creates task for due schedule entry", async () => {
    vi.useFakeTimers();
    // Tuesday 2026-01-06 at 02:01 — seed the scheduler
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    // Advance to Wednesday 02:01 — next cron trigger at 02:00
    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentName).toBe("my-agent");
    expect(tasks[0].origin).toBe("recurring");
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(tasks[0].name).toMatch(/^my-agent-ns-/);
  });

  // -------------------------------------------------------------------------
  // 4. Skips schedule that already ran after the cron trigger
  // -------------------------------------------------------------------------

  it("skips schedule that already ran", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    // Advance to next trigger and dispatch
    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks1 = await scheduler.evaluateSchedules();
    expect(tasks1).toHaveLength(1);

    // Second call in same period — lastRun was recorded, so should skip
    const tasks2 = await scheduler.evaluateSchedules();
    expect(tasks2).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. Agent-level and schedule-level variables are merged
  // -------------------------------------------------------------------------

  it("merges agent-level and schedule-level variables", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [
        {
          name: "my-agent",
          variables: { repo_url: "https://gitlab.com/team/repo.git" },
        },
      ],
      schedule: [
        {
          agent: "my-agent",
          cron: "0 2 * * 1-5",
          enabled: true,
          variables: { category: "tests" },
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].variables).toMatchObject({
      repo_url: "https://gitlab.com/team/repo.git",
      category: "tests",
    });
  });

  // -------------------------------------------------------------------------
  // 6. Schedule-level variables override agent-level
  // -------------------------------------------------------------------------

  it("schedule-level variables override agent-level variables", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent", variables: { category: "refactoring" } }],
      schedule: [
        {
          agent: "my-agent",
          cron: "0 2 * * 1-5",
          enabled: true,
          variables: { category: "tests" },
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].variables?.["category"]).toBe("tests");
  });

  // -------------------------------------------------------------------------
  // 7. Saves state after creating tasks
  // -------------------------------------------------------------------------

  it("saves state after creating tasks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    await scheduler.evaluateSchedules();

    const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
    const state = await readJsonFile<{ lastRuns: Record<string, string> }>(statePath);
    expect(state).not.toBeNull();

    const key = "my-agent:0 2 * * 1-5";
    expect(state!.lastRuns[key]).toBeDefined();
    expect(new Date(state!.lastRuns[key]).getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 8. Does not save state when no tasks were created
  // -------------------------------------------------------------------------

  it("does not save state when no tasks created", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    // All disabled — no tasks will be created
    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: false }],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.evaluateSchedules();

    // State file must not be written
    const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
    const state = await readJsonFile<unknown>(statePath);
    expect(state).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 9. Task has correct shape
  // -------------------------------------------------------------------------

  it("task has correct shape with all required fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [
        {
          agent: "my-agent",
          cron: "0 2 * * 1-5",
          enabled: true,
          variables: { key: "value" },
        },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.id).toMatch(/^ns-[0-9a-f]{8}$/);
    expect(task.name).toMatch(/^my-agent-ns-/);
    expect(task.origin).toBe("recurring");
    expect(task.agentName).toBe("my-agent");
    expect(task.status).toBe("pending");
    expect(task.variables).toEqual({ key: "value" });
    expect(task.prompt).toBe("");
    expect(task.timeout).toBe("30m");
    expect(task.createdAt).toBeDefined();
    expect(new Date(task.createdAt).getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 10. Notify propagation
  // -------------------------------------------------------------------------

  it("uses schedule-level notify when set on schedule entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent", notify: false }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true, notify: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].notify).toBe(true);
  });

  it("falls back to agent-level notify when schedule does not set it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent", notify: true }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].notify).toBe(true);
  });

  it("task.notify is undefined when neither schedule nor agent sets it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].notify).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 11. State round-trip: loadState skips already-ran schedule
  // -------------------------------------------------------------------------

  it("restores state and skips schedule that already ran after the trigger", async () => {
    vi.useFakeTimers();
    // Tuesday 02:01 — cron fires at 02:00
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    // Pre-populate state: lastRun at 02:00:30 (after the 02:00 trigger)
    const key = "my-agent:0 2 * * 1-5";
    const stateData = { lastRuns: { [key]: new Date("2026-01-06T02:00:30Z").toISOString() } };
    await fs.writeFile(
      path.join(tmpDir, ".nightshift", "scheduler.json"),
      JSON.stringify(stateData),
      "utf-8",
    );

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.loadState(tmpDir);

    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(0);
  });

  it("creates task when lastRun predates the previous cron trigger", async () => {
    vi.useFakeTimers();
    // Tuesday 02:01 — cron fires at 02:00
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    // Pre-populate state: lastRun at 01:59 (before the 02:00 trigger)
    const key = "my-agent:0 2 * * 1-5";
    const stateData = { lastRuns: { [key]: new Date("2026-01-06T01:59:00Z").toISOString() } };
    await fs.writeFile(
      path.join(tmpDir, ".nightshift", "scheduler.json"),
      JSON.stringify(stateData),
      "utf-8",
    );

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.loadState(tmpDir);

    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentName).toBe("my-agent");
  });

  // -------------------------------------------------------------------------
  // 12. Multiple schedule entries
  // -------------------------------------------------------------------------

  it("creates tasks for multiple due schedule entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }],
      schedule: [
        { agent: "agent-a", cron: "0 2 * * 1-5", enabled: true },
        { agent: "agent-b", cron: "0 2 * * 1-5", enabled: true },
        { agent: "agent-a", cron: "0 3 * * *", enabled: false }, // disabled
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(2);
    const agentNames = tasks.map((t) => t.agentName);
    expect(agentNames).toContain("agent-a");
    expect(agentNames).toContain("agent-b");
  });

  // -------------------------------------------------------------------------
  // 13. State key uses agent:cron format
  // -------------------------------------------------------------------------

  it("uses agent:cron as state key to avoid collisions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    await scheduler.evaluateSchedules();

    const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
    const state = await readJsonFile<{ lastRuns: Record<string, string> }>(statePath);

    expect(state!.lastRuns).toHaveProperty("my-agent:0 2 * * 1-5");
  });

  // -------------------------------------------------------------------------
  // 14. No variables when neither agent nor schedule defines them
  // -------------------------------------------------------------------------

  it("task.variables is undefined when no variables defined", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:00Z"));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [{ agent: "my-agent", cron: "0 2 * * 1-5", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-07T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].variables).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 15. New schedule does not dispatch retroactively
  // -------------------------------------------------------------------------

  it("does not dispatch for a newly added schedule (no prior state)", async () => {
    vi.useFakeTimers();
    // Wednesday 2026-01-07 at 10:00 — cron "0 2 * * 4" fires Thursday at 02:00
    // Previous run would be last Thursday (2026-01-01), but since no prior state
    // exists, the scheduler should seed and NOT dispatch.
    vi.setSystemTime(new Date("2026-01-07T10:00:00Z"));

    const config = makeConfig({
      agents: [{ name: "weekly-agent" }],
      schedule: [{ agent: "weekly-agent", cron: "0 2 * * 4", enabled: true }],
    });

    const scheduler = new Scheduler(config, logger);

    // First call: seeds the state, returns no tasks
    const tasks1 = await scheduler.evaluateSchedules();
    expect(tasks1).toHaveLength(0);

    // Verify state was seeded
    const statePath = path.join(tmpDir, ".nightshift", "scheduler.json");
    const state = await readJsonFile<{ lastRuns: Record<string, string> }>(statePath);
    expect(state).not.toBeNull();
    expect(state!.lastRuns["weekly-agent:0 2 * * 4"]).toBe("2026-01-07T10:00:00.000Z");

    // Advance to Thursday 02:01 — next cron trigger fires
    vi.setSystemTime(new Date("2026-01-08T02:01:00Z"));
    const tasks2 = await scheduler.evaluateSchedules();
    expect(tasks2).toHaveLength(1);
    expect(tasks2[0].agentName).toBe("weekly-agent");
  });
});

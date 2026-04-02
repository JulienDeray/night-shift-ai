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

    // Confirm the task was dispatched
    await scheduler.confirmDispatched(tasks1.map((t) => t.id));

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
  // 15. Pool-full scenario: unconfirmed tasks reappear
  // -------------------------------------------------------------------------

  it("returns unconfirmed tasks again on next evaluateSchedules call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }, { name: "agent-c" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
        { agent: "agent-c", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    // Advance past 02:02 so previousRuns returns 02:02 (> seed time 02:01:30)
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(3);

    // Confirm only 2 of 3 were dispatched
    await scheduler.confirmDispatched([tasks[0].id, tasks[1].id]);

    // Next tick — advance past 02:03
    vi.setSystemTime(new Date("2026-01-06T02:03:30Z"));
    const tasks2 = await scheduler.evaluateSchedules();
    // agent-a and agent-b: lastRuns updated to 02:02:30, prevRun=02:03 > 02:02:30 → due again
    // agent-c: lastRuns never updated (still 02:01:30), prevRun=02:03 > 02:01:30 → due again
    // All 3 should reappear, and agent-c specifically was never lost
    expect(tasks2).toHaveLength(3);
    const agentNames = tasks2.map((t) => t.agentName);
    expect(agentNames).toContain("agent-c");
  });

  it("returns all tasks again when none are confirmed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    // Advance past 02:02
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(2);

    // Confirm NONE — next evaluate both should reappear
    vi.setSystemTime(new Date("2026-01-06T02:03:30Z"));
    const tasks2 = await scheduler.evaluateSchedules();
    expect(tasks2).toHaveLength(2);
  });

  it("does not return tasks again when all are confirmed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    // Advance past 02:02
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(2);

    // Confirm ALL
    await scheduler.confirmDispatched(tasks.map((t) => t.id));

    // Same period — should return nothing (already confirmed)
    const tasks2 = await scheduler.evaluateSchedules();
    expect(tasks2).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 16. New schedule does not dispatch retroactively
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

// ---------------------------------------------------------------------------
// fastForwardStaleEntries
// ---------------------------------------------------------------------------

describe("Scheduler.fastForwardStaleEntries()", () => {
  let tmpDir: string;
  let logger: Logger;
  let origCwd: typeof process.cwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-sched-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift"), { recursive: true });
    logger = Logger.createCliLogger(false);
    origCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(async () => {
    process.cwd = origCwd;
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("fast-forwards stale lastRun to now so missed schedules don't catch up", async () => {
    vi.useFakeTimers();
    // Simulate daemon restart on Wednesday after being off since Sunday.
    // Cron "0 2 * * 1-5" triggers Mon-Fri at 02:00.
    // lastRun is from Sunday (before Mon/Tue triggers), so it's stale.
    vi.setSystemTime(new Date("2026-01-08T10:00:00Z")); // Wednesday 10:00

    const key = "my-agent:0 2 * * 1-5";
    const stateData = { lastRuns: { [key]: new Date("2026-01-05T02:00:30Z").toISOString() } }; // Sunday
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
    await scheduler.fastForwardStaleEntries(tmpDir);

    // After fast-forward, evaluateSchedules should NOT create a catch-up task
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(0);
  });

  it("does not fast-forward entries that are already current", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-08T02:01:00Z")); // Wednesday 02:01

    // lastRun at 02:00:30 — after today's trigger
    const key = "my-agent:0 2 * * 1-5";
    const stateData = { lastRuns: { [key]: new Date("2026-01-08T02:00:30Z").toISOString() } };
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
    await scheduler.fastForwardStaleEntries(tmpDir);

    // State should NOT have been changed — verify file timestamp or content
    const state = await readJsonFile<{ lastRuns: Record<string, string> }>(
      path.join(tmpDir, ".nightshift", "scheduler.json"),
    );
    // lastRun should still be 02:00:30, not fast-forwarded
    expect(state!.lastRuns[key]).toBe("2026-01-08T02:00:30.000Z");
  });

  it("fast-forwards multiple stale entries from different agents", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-08T10:00:00Z")); // Wednesday 10:00

    // Both agents' lastRun from 3 days ago
    const stateData = {
      lastRuns: {
        "agent-a:0 2 * * 1-5": new Date("2026-01-05T02:00:30Z").toISOString(),
        "agent-b:0 2 * * 1-5": new Date("2026-01-05T02:00:30Z").toISOString(),
      },
    };
    await fs.writeFile(
      path.join(tmpDir, ".nightshift", "scheduler.json"),
      JSON.stringify(stateData),
      "utf-8",
    );

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }],
      schedule: [
        { agent: "agent-a", cron: "0 2 * * 1-5", enabled: true },
        { agent: "agent-b", cron: "0 2 * * 1-5", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.loadState(tmpDir);
    await scheduler.fastForwardStaleEntries(tmpDir);

    // Neither agent should produce catch-up tasks
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(0);
  });

  it("allows the NEXT scheduled run to fire after fast-forward", async () => {
    vi.useFakeTimers();
    // Restart at Wednesday 10:00 — stale lastRun from Sunday
    vi.setSystemTime(new Date("2026-01-08T10:00:00Z"));

    const key = "my-agent:0 2 * * 1-5";
    const stateData = { lastRuns: { [key]: new Date("2026-01-05T02:00:30Z").toISOString() } };
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
    await scheduler.fastForwardStaleEntries(tmpDir);

    // No catch-up now
    expect(await scheduler.evaluateSchedules()).toHaveLength(0);

    // Advance to Thursday 02:01 — next genuine trigger
    vi.setSystemTime(new Date("2026-01-09T02:01:00Z"));
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].agentName).toBe("my-agent");
  });
});

// ---------------------------------------------------------------------------
// pendingCount
// ---------------------------------------------------------------------------

describe("Scheduler.pendingCount", () => {
  let tmpDir: string;
  let logger: Logger;
  let origCwd: typeof process.cwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-sched-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift"), { recursive: true });
    logger = Logger.createCliLogger(false);
    origCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(async () => {
    process.cwd = origCwd;
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("is 0 before any tasks are evaluated", () => {
    const scheduler = new Scheduler(makeConfig(), logger);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("reflects unconfirmed tasks after evaluateSchedules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      agents: [{ name: "agent-a" }, { name: "agent-b" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await seedScheduler(scheduler);

    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tasks = await scheduler.evaluateSchedules();
    expect(tasks).toHaveLength(2);
    expect(scheduler.pendingCount).toBe(2);

    // Confirm one
    await scheduler.confirmDispatched([tasks[0].id]);
    expect(scheduler.pendingCount).toBe(1);

    // Confirm the other
    await scheduler.confirmDispatched([tasks[1].id]);
    expect(scheduler.pendingCount).toBe(0);
  });
});

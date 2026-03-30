import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import type { NightShiftConfig, NightShiftTask } from "../../src/core/types.js";
import type { TaskResult } from "../../src/daemon/agent-pool.js";
import type { AgentRunResult } from "../../src/agent/engine-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<NightShiftConfig>): NightShiftConfig {
  return {
    workspace: "./workspace",
    inbox: "./inbox",
    maxConcurrent: 1,
    maxDispatchesPerTick: 2,
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
 * A minimal mock pool that lets us control when tasks complete.
 * Mirrors the AgentPool interface used by the orchestrator tick pattern.
 */
class MockPool {
  private maxConcurrent: number;
  private running = new Map<string, NightShiftTask>();
  private completed: TaskResult[] = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  get activeCount(): number {
    return this.running.size;
  }

  canAccept(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  dispatch(task: NightShiftTask): void {
    if (!this.canAccept()) return;
    this.running.set(task.id, task);
  }

  /** Simulate a task completing */
  completeTask(taskId: string): void {
    const task = this.running.get(taskId);
    if (!task) return;
    this.running.delete(taskId);
    const result: AgentRunResult = {
      runId: taskId,
      agentName: task.agentName ?? "",
      status: "SUCCESS",
      finalOutput: "done",
      perStep: [],
      totalDurationMs: 100,
    };
    this.completed.push({
      task,
      result,
      startedAt: new Date(),
      completedAt: new Date(),
    });
  }

  collectCompleted(): TaskResult[] {
    const results = [...this.completed];
    this.completed = [];
    return results;
  }

  /** Complete all running tasks */
  completeAll(): void {
    for (const id of [...this.running.keys()]) {
      this.completeTask(id);
    }
  }
}

/**
 * Simulates one tick of the orchestrator dispatch pattern:
 * 1. Collect completed tasks (frees slots)
 * 2. Evaluate schedules
 * 3. Dispatch up to pool capacity AND per-tick cap
 * 4. Confirm dispatched
 *
 * Returns the tasks that were dispatched and those that were not.
 */
async function simulateTick(
  scheduler: Scheduler,
  pool: MockPool,
  config?: NightShiftConfig,
): Promise<{ dispatched: NightShiftTask[]; notDispatched: NightShiftTask[] }> {
  // Step 1: Collect completed (frees slots)
  pool.collectCompleted();

  // Step 2: Evaluate schedules
  const scheduledTasks = await scheduler.evaluateSchedules();

  // Step 3: Dispatch up to capacity AND per-tick cap
  const dispatched: NightShiftTask[] = [];
  const notDispatched: NightShiftTask[] = [];
  let tickDispatches = 0;
  const maxDispatchesPerTick = config?.maxDispatchesPerTick;

  for (const task of scheduledTasks) {
    if (!pool.canAccept()) {
      notDispatched.push(task);
      continue;
    }
    if (maxDispatchesPerTick !== undefined && tickDispatches >= maxDispatchesPerTick) {
      notDispatched.push(task);
      continue;
    }
    pool.dispatch(task);
    dispatched.push(task);
    tickDispatches++;
  }

  // Step 4: Confirm only dispatched
  await scheduler.confirmDispatched(dispatched.map((t) => t.id));

  return { dispatched, notDispatched };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator tick pattern: Scheduler + AgentPool", () => {
  let tmpDir: string;
  let logger: Logger;
  let origCwd: typeof process.cwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-tick-"));
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

  it("dispatches as many scheduled tasks as pool allows, remaining tasks are not lost", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      maxConcurrent: 1,
      agents: [{ name: "agent-a" }, { name: "agent-b" }, { name: "agent-c" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
        { agent: "agent-c", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    // Seed
    const seedTasks = await scheduler.evaluateSchedules();
    expect(seedTasks).toHaveLength(0);

    const pool = new MockPool(1);

    // Advance time so all 3 schedules are due
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));

    // Tick 1: Should dispatch 1, not dispatch 2
    const tick1 = await simulateTick(scheduler, pool);
    expect(tick1.dispatched).toHaveLength(1);
    expect(tick1.notDispatched).toHaveLength(2);

    // Pool is full (1 active task using the slot)
    expect(pool.canAccept()).toBe(false);

    // Simulate the dispatched task completing
    pool.completeAll();
    expect(pool.canAccept()).toBe(true);

    // Tick 2: Advance time. The 2 undispatched tasks should reappear.
    vi.setSystemTime(new Date("2026-01-06T02:03:30Z"));
    const tick2 = await simulateTick(scheduler, pool);

    // Should dispatch 1 more (pool capacity = 1)
    expect(tick2.dispatched).toHaveLength(1);
    // The dispatched one in tick1 already had its lastRuns updated,
    // and is now due again (new minute). Plus the 1 remaining undispatched.
    // Total due = 3 (all three agents), dispatched = 1, not dispatched = 2.
    expect(tick2.notDispatched).toHaveLength(2);

    // Complete again
    pool.completeAll();

    // Tick 3: Advance time. Still should have remaining tasks.
    vi.setSystemTime(new Date("2026-01-06T02:04:30Z"));
    const tick3 = await simulateTick(scheduler, pool);
    expect(tick3.dispatched).toHaveLength(1);

    // Key assertion: All 3 agents eventually get dispatched across ticks
    const allDispatched = [
      ...tick1.dispatched,
      ...tick2.dispatched,
      ...tick3.dispatched,
    ];
    const agentNames = new Set(allDispatched.map((t) => t.agentName));
    // All 3 unique agents should have been dispatched across the 3 ticks
    expect(agentNames.size).toBe(3);
  });

  it("collects completed tasks before dispatching new ones (freed slots are immediately available)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      maxConcurrent: 1,
      agents: [{ name: "agent-a" }],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    const seedTasks = await scheduler.evaluateSchedules();
    expect(seedTasks).toHaveLength(0);

    const pool = new MockPool(1);

    // Tick 1: dispatch agent-a
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tick1 = await simulateTick(scheduler, pool);
    expect(tick1.dispatched).toHaveLength(1);
    expect(pool.canAccept()).toBe(false);

    // Simulate the task completing
    pool.completeAll();
    // Note: completed tasks are in the completedQueue but not yet collected.
    // The pool slot is freed (running map cleared) but the results are waiting.
    // canAccept is now true since the running map is empty.
    expect(pool.canAccept()).toBe(true);

    // Tick 2: The simulateTick calls collectCompleted first (clearing completed queue),
    // then evaluates schedules, then dispatches. This proves the pattern works:
    // freed slots are available for new dispatches within the same tick.
    vi.setSystemTime(new Date("2026-01-06T02:03:30Z"));
    const tick2 = await simulateTick(scheduler, pool);

    // A new task should be dispatched for agent-a (next minute)
    expect(tick2.dispatched).toHaveLength(1);
    expect(tick2.dispatched[0].agentName).toBe("agent-a");
  });
});

describe("per-tick dispatch cap", () => {
  let tmpDir: string;
  let logger: Logger;
  let origCwd: typeof process.cwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-tick-cap-"));
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

  it("limits dispatches to maxDispatchesPerTick even when pool has more capacity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    // Pool capacity = 5, but cap = 2, so only 2 should be dispatched
    const config = makeConfig({
      maxConcurrent: 5,
      maxDispatchesPerTick: 2,
      agents: [
        { name: "agent-a" },
        { name: "agent-b" },
        { name: "agent-c" },
        { name: "agent-d" },
        { name: "agent-e" },
      ],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
        { agent: "agent-c", cron: "* * * * *", enabled: true },
        { agent: "agent-d", cron: "* * * * *", enabled: true },
        { agent: "agent-e", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    // Seed
    await scheduler.evaluateSchedules();

    const pool = new MockPool(5);

    // Advance so all 5 schedules are due
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));

    const tick1 = await simulateTick(scheduler, pool, config);

    // Despite pool having 5 open slots, cap limits to 2 dispatches
    expect(tick1.dispatched).toHaveLength(2);
    expect(tick1.notDispatched).toHaveLength(3);
  });

  it("remaining tasks after cap are retried next tick (not lost)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      maxConcurrent: 5,
      maxDispatchesPerTick: 2,
      agents: [
        { name: "agent-a" },
        { name: "agent-b" },
        { name: "agent-c" },
      ],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
        { agent: "agent-c", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.evaluateSchedules();

    const pool = new MockPool(5);

    // Tick 1: all 3 due, cap=2 → 2 dispatched, 1 not dispatched
    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tick1 = await simulateTick(scheduler, pool, config);
    expect(tick1.dispatched).toHaveLength(2);
    expect(tick1.notDispatched).toHaveLength(1);

    // Complete the 2 dispatched tasks
    pool.completeAll();

    // Tick 2: the 1 undispatched task should still be available (not lost)
    vi.setSystemTime(new Date("2026-01-06T02:03:30Z"));
    const tick2 = await simulateTick(scheduler, pool, config);

    // At least the undispatched agent from tick1 plus newly due agents
    expect(tick2.dispatched.length).toBeGreaterThanOrEqual(1);
    const allDispatchedNames = new Set([
      ...tick1.dispatched.map((t) => t.agentName),
      ...tick2.dispatched.map((t) => t.agentName),
    ]);
    // All 3 agents should have been dispatched across ticks
    expect(allDispatchedNames.size).toBe(3);
  });

  it("cap of 1 restricts to exactly 1 dispatch per tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-06T02:01:30Z"));

    const config = makeConfig({
      maxConcurrent: 10,
      maxDispatchesPerTick: 1,
      agents: [
        { name: "agent-a" },
        { name: "agent-b" },
        { name: "agent-c" },
      ],
      schedule: [
        { agent: "agent-a", cron: "* * * * *", enabled: true },
        { agent: "agent-b", cron: "* * * * *", enabled: true },
        { agent: "agent-c", cron: "* * * * *", enabled: true },
      ],
    });

    const scheduler = new Scheduler(config, logger);
    await scheduler.evaluateSchedules();

    const pool = new MockPool(10);

    vi.setSystemTime(new Date("2026-01-06T02:02:30Z"));
    const tick1 = await simulateTick(scheduler, pool, config);

    expect(tick1.dispatched).toHaveLength(1);
    expect(tick1.notDispatched).toHaveLength(2);
  });
});

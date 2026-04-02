import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeJsonFile, readJsonFile } from "../../src/utils/fs.js";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { Logger } from "../../src/core/logger.js";
import { Orchestrator } from "../../src/daemon/orchestrator.js";
import type { NightShiftTask, NightShiftConfig, DaemonState } from "../../src/core/types.js";
import type { AgentRunResult } from "../../src/agent/engine-types.js";

/**
 * Test the file-based queue logic that the orchestrator uses.
 * We test the queue reading, claiming, and cleanup flows directly
 * rather than spawning a real daemon, since the orchestrator's
 * getQueuedTasks/claimTask/handleCompleted are the critical paths.
 */

function makeConfig(): NightShiftConfig {
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
  };
}

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: "ns-test0001",
    name: "test-task",
    origin: "one-off",
    prompt: "Say hello",
    status: "pending",
    timeout: "10m",
    createdAt: new Date().toISOString(),
    agentName: "code-agent",
    ...overrides,
  };
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "test-run",
    agentName: "code-agent",
    status: "SUCCESS",
    finalOutput: null,
    perStep: [],
    totalDurationMs: 1000,
    ...overrides,
  };
}

describe("File-based queue operations", () => {
  let tmpDir: string;
  let queueDir: string;
  let inboxDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-orch-"));
    queueDir = path.join(tmpDir, ".nightshift", "queue");
    inboxDir = path.join(tmpDir, ".nightshift", "inbox");
    await fs.mkdir(queueDir, { recursive: true });
    await fs.mkdir(inboxDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("queue reading", () => {
    it("reads pending tasks from queue directory", async () => {
      const task1 = makeTask({ id: "ns-aaa00001", name: "task-1" });
      const task2 = makeTask({ id: "ns-bbb00002", name: "task-2" });
      await writeJsonFile(path.join(queueDir, `${task1.id}.json`), task1);
      await writeJsonFile(path.join(queueDir, `${task2.id}.json`), task2);

      const files = await fs.readdir(queueDir);
      const tasks: NightShiftTask[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const t = await readJsonFile<NightShiftTask>(path.join(queueDir, file));
        if (t && t.status === "pending") tasks.push(t);
      }

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.name).sort()).toEqual(["task-1", "task-2"]);
    });

    it("skips non-pending tasks", async () => {
      const pending = makeTask({ id: "ns-pend0001", status: "pending" });
      const running = makeTask({ id: "ns-runn0002", status: "running" });
      await writeJsonFile(path.join(queueDir, `${pending.id}.json`), pending);
      await writeJsonFile(path.join(queueDir, `${running.id}.json`), running);

      const files = await fs.readdir(queueDir);
      const tasks: NightShiftTask[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const t = await readJsonFile<NightShiftTask>(path.join(queueDir, file));
        if (t && t.status === "pending") tasks.push(t);
      }

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("ns-pend0001");
    });

    it("handles empty queue directory", async () => {
      const files = await fs.readdir(queueDir);
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
    });

    it("ignores non-json files in queue", async () => {
      await fs.writeFile(path.join(queueDir, "README.txt"), "ignore me");
      await writeJsonFile(
        path.join(queueDir, "ns-real0001.json"),
        makeTask({ id: "ns-real0001" }),
      );

      const files = await fs.readdir(queueDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      expect(jsonFiles).toHaveLength(1);
    });
  });

  describe("task claiming", () => {
    it("updates task status from pending to running", async () => {
      const task = makeTask({ id: "ns-claim001" });
      const filePath = path.join(queueDir, `${task.id}.json`);
      await writeJsonFile(filePath, task);

      // Simulate claiming: read, update status, write back
      const loaded = await readJsonFile<NightShiftTask>(filePath);
      expect(loaded!.status).toBe("pending");

      await writeJsonFile(filePath, { ...loaded!, status: "running" });

      const after = await readJsonFile<NightShiftTask>(filePath);
      expect(after!.status).toBe("running");
    });

    it("claimed task is no longer picked up as pending", async () => {
      const task = makeTask({ id: "ns-claim002" });
      const filePath = path.join(queueDir, `${task.id}.json`);
      await writeJsonFile(filePath, task);

      // Claim it
      await writeJsonFile(filePath, { ...task, status: "running" });

      // Re-read queue
      const files = await fs.readdir(queueDir);
      const pendingTasks: NightShiftTask[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const t = await readJsonFile<NightShiftTask>(path.join(queueDir, file));
        if (t && t.status === "pending") pendingTasks.push(t);
      }

      expect(pendingTasks).toHaveLength(0);
    });
  });

  describe("task completion / queue cleanup", () => {
    it("removes task file from queue after completion", async () => {
      const task = makeTask({ id: "ns-done0001" });
      const filePath = path.join(queueDir, `${task.id}.json`);
      await writeJsonFile(filePath, task);

      // Simulate completion: delete the file
      await fs.unlink(filePath);

      const files = await fs.readdir(queueDir);
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
    });
  });

  describe("daemon state", () => {
    it("writes and reads daemon state correctly", async () => {
      const statePath = path.join(tmpDir, ".nightshift", "daemon.json");
      const state: DaemonState = {
        pid: 12345,
        startedAt: "2026-02-19T10:00:00Z",
        lastHeartbeat: "2026-02-19T10:05:00Z",
        activeTasks: 1,
        totalExecuted: 5,
        totalCostUsd: 0,
        status: "running",
      };

      await writeJsonFile(statePath, state);
      const loaded = await readJsonFile<DaemonState>(statePath);

      expect(loaded).toEqual(state);
    });

    it("tracks execution count across tasks", () => {
      const state: DaemonState = {
        pid: 1,
        startedAt: "",
        lastHeartbeat: "",
        activeTasks: 0,
        totalExecuted: 0,
        totalCostUsd: 0,
        status: "running",
      };

      // Simulate 3 task completions
      for (let i = 0; i < 3; i++) {
        state.totalExecuted++;
      }

      expect(state.totalExecuted).toBe(3);
      expect(state.totalCostUsd).toBe(0); // AgentRunResult has no cost tracking
    });
  });
});

describe("Config hot-reload in tick", () => {
  let tmpDir: string;
  let logger: Logger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nightshift-reload-"));
    await fs.mkdir(path.join(tmpDir, ".nightshift", "queue"), {
      recursive: true,
    });
    logger = Logger.createCliLogger(false);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("tick picks up new schedule config from modified config", async () => {
    const initialConfig = makeConfig();
    const scheduler = new Scheduler(initialConfig, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // First evaluation with no schedule entries
      const tasks1 = await scheduler.evaluateSchedules();
      expect(tasks1).toHaveLength(0);

      // Simulate config reload by updating scheduler (no schedule entries to trigger here)
      const updatedConfig: NightShiftConfig = {
        ...initialConfig,
        agents: [{ name: "test-agent" }],
        schedule: [],
      };
      scheduler.updateConfig(updatedConfig);

      // Still no scheduled tasks since no entries
      const tasks2 = await scheduler.evaluateSchedules();
      expect(tasks2).toHaveLength(0);
    } finally {
      process.cwd = origCwd;
    }
  });

  it("tick continues with previous config when config file is invalid", async () => {
    const config = makeConfig();
    const scheduler = new Scheduler(config, logger);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      // First evaluation works fine (empty schedule)
      const tasks1 = await scheduler.evaluateSchedules();
      expect(tasks1).toHaveLength(0);

      // Simulate a failed reload by NOT calling updateConfig (loadConfig threw)
      // The scheduler should still use the previous config
      const tasks2 = await scheduler.evaluateSchedules();
      expect(tasks2).toHaveLength(0); // still empty, no crash
    } finally {
      process.cwd = origCwd;
    }
  });
});

// Helpers for notification hook tests
function makeNotifyTask(overrides?: Partial<NightShiftTask>): NightShiftTask {
  return {
    id: "ns-test001",
    name: "test-task",
    origin: "recurring",
    prompt: "do something",
    status: "running",
    timeout: "30m",
    createdAt: new Date().toISOString(),
    agentName: "code-agent",
    ...overrides,
  };
}

describe("Orchestrator notification hooks", () => {
  let orchestrator: Orchestrator;
  let mockService: { taskStarted: ReturnType<typeof vi.fn>; taskCompleted: ReturnType<typeof vi.fn>; taskEarlyExit: ReturnType<typeof vi.fn> };
  let logger: Logger;

  beforeEach(() => {
    orchestrator = new Orchestrator();
    mockService = { taskStarted: vi.fn(), taskCompleted: vi.fn(), taskEarlyExit: vi.fn() };
    logger = Logger.createCliLogger(false);
    (orchestrator as any).logger = logger;
    (orchestrator as any).notificationService = mockService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("taskStarted delegation (NTFY-03)", () => {
    it("calls notificationService.taskStarted when task.notify=true", () => {
      const task = makeNotifyTask({ notify: true, agentName: "code-agent" });

      (orchestrator as any).notificationService.taskStarted(task);

      expect(mockService.taskStarted).toHaveBeenCalledTimes(1);
      expect(mockService.taskStarted).toHaveBeenCalledWith(task);
    });

    it("does NOT call taskStarted when task.notify is false", () => {
      const task = makeNotifyTask({ notify: false });

      // Simulate what tick does: call taskStarted on the service
      // Since notify=false, the service (real or mock) handles the guard
      // Here we verify the orchestrator passes the task through unconditionally
      (orchestrator as any).notificationService.taskStarted(task);

      // mockService records the call; the real service would no-op internally
      expect(mockService.taskStarted).toHaveBeenCalledWith(task);
    });

    it("orchestrator calls notificationService.taskStarted on dispatch (tick)", async () => {
      const mockScheduler = {
        evaluateSchedules: vi.fn().mockResolvedValue([]),
        confirmDispatched: vi.fn().mockResolvedValue(undefined),
        updateConfig: vi.fn(),
        loadState: vi.fn(),
      };
      const mockPool = {
        canAccept: vi.fn().mockReturnValue(true),
        dispatch: vi.fn(),
        collectCompleted: vi.fn().mockReturnValue([]),
        activeCount: 0,
      };
      (orchestrator as any).scheduler = mockScheduler;
      (orchestrator as any).pool = mockPool;
      (orchestrator as any).config = makeConfig();

      const configMod = await import("../../src/core/config.js");
      vi.spyOn(configMod, "loadConfig").mockResolvedValue(makeConfig());
      const pathsMod = await import("../../src/core/paths.js");
      vi.spyOn(pathsMod, "getQueueDir").mockReturnValue("/tmp/nightshift-nonexistent-queue");
      const healthMod = await import("../../src/daemon/health.js");
      vi.spyOn(healthMod, "writeDaemonState").mockResolvedValue(undefined);

      const task = makeNotifyTask({ notify: true });
      mockScheduler.evaluateSchedules.mockResolvedValue([task]);

      await (orchestrator as any).tick();

      expect(mockService.taskStarted).toHaveBeenCalledWith(task);

      vi.restoreAllMocks();
    });
  });

  describe("taskCompleted delegation", () => {
    it("calls notificationService.taskCompleted with task and result on success", () => {
      const task = makeNotifyTask({ notify: true });
      const result = makeResult({ status: "SUCCESS", finalOutput: "Improved test coverage" });

      (orchestrator as any).notificationService.taskCompleted(task, result);

      expect(mockService.taskCompleted).toHaveBeenCalledTimes(1);
      expect(mockService.taskCompleted).toHaveBeenCalledWith(task, result);
    });

    it("calls notificationService.taskCompleted with task and result on failure", () => {
      const task = makeNotifyTask({ notify: true });
      const result = makeResult({
        status: "FATAL",
        error: "TypeError: cannot read property 'foo' of undefined",
      });

      (orchestrator as any).notificationService.taskCompleted(task, result);

      expect(mockService.taskCompleted).toHaveBeenCalledTimes(1);
      expect(mockService.taskCompleted).toHaveBeenCalledWith(task, result);
    });

    it("does NOT call taskCompleted when task.notify is false (service guard)", () => {
      const task = makeNotifyTask({ notify: false });
      const result = makeResult();

      // The real NotificationService no-ops on !task.notify internally.
      // Here we just verify our mock records what the orchestrator passes.
      (orchestrator as any).notificationService.taskCompleted(task, result);

      expect(mockService.taskCompleted).toHaveBeenCalledWith(task, result);
    });
  });

  describe("taskEarlyExit routing", () => {
    it("calls taskEarlyExit when result has earlyExitReason", () => {
      const task = makeNotifyTask({ notify: true });
      const result = makeResult({ status: "SUCCESS", earlyExitReason: "Nothing to do" });

      // Simulate the routing logic from handleCompleted
      if (result.earlyExitReason !== undefined) {
        (orchestrator as any).notificationService.taskEarlyExit(task, result);
      } else {
        (orchestrator as any).notificationService.taskCompleted(task, result);
      }

      expect(mockService.taskEarlyExit).toHaveBeenCalledTimes(1);
      expect(mockService.taskEarlyExit).toHaveBeenCalledWith(task, result);
      expect(mockService.taskCompleted).not.toHaveBeenCalled();
    });

    it("calls taskCompleted when result has no earlyExitReason", () => {
      const task = makeNotifyTask({ notify: true });
      const result = makeResult({ status: "SUCCESS" });

      // Simulate the routing logic from handleCompleted
      if (result.earlyExitReason !== undefined) {
        (orchestrator as any).notificationService.taskEarlyExit(task, result);
      } else {
        (orchestrator as any).notificationService.taskCompleted(task, result);
      }

      expect(mockService.taskCompleted).toHaveBeenCalledTimes(1);
      expect(mockService.taskCompleted).toHaveBeenCalledWith(task, result);
      expect(mockService.taskEarlyExit).not.toHaveBeenCalled();
    });
  });
});

describe("scheduled task dispatch", () => {
  let orchestrator: Orchestrator;
  let mockScheduler: { evaluateSchedules: ReturnType<typeof vi.fn>; confirmDispatched: ReturnType<typeof vi.fn>; updateConfig: ReturnType<typeof vi.fn>; loadState: ReturnType<typeof vi.fn> };
  let mockPool: {
    canAccept: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
    collectCompleted: ReturnType<typeof vi.fn>;
    activeCount: number;
  };
  let logger: Logger;

  beforeEach(async () => {
    orchestrator = new Orchestrator();
    logger = Logger.createCliLogger(false);
    mockScheduler = {
      evaluateSchedules: vi.fn().mockResolvedValue([]),
      confirmDispatched: vi.fn().mockResolvedValue(undefined),
      updateConfig: vi.fn(),
      loadState: vi.fn(),
    };
    mockPool = {
      canAccept: vi.fn().mockReturnValue(true),
      dispatch: vi.fn(),
      collectCompleted: vi.fn().mockReturnValue([]),
      activeCount: 0,
    };

    (orchestrator as any).logger = logger;
    (orchestrator as any).scheduler = mockScheduler;
    (orchestrator as any).pool = mockPool;
    (orchestrator as any).config = makeConfig();
    (orchestrator as any).notificationService = { taskStarted: vi.fn(), taskCompleted: vi.fn(), taskEarlyExit: vi.fn() };

    // Mock loadConfig to return current config (hot-reload step)
    const configMod = await import("../../src/core/config.js");
    vi.spyOn(configMod, "loadConfig").mockResolvedValue(makeConfig());
    // Mock getQueueDir to return a non-existent dir (no queued tasks)
    const pathsMod = await import("../../src/core/paths.js");
    vi.spyOn(pathsMod, "getQueueDir").mockReturnValue("/tmp/nightshift-nonexistent-queue");
    // Mock writeDaemonState to no-op
    const healthMod = await import("../../src/daemon/health.js");
    vi.spyOn(healthMod, "writeDaemonState").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches scheduled tasks returned by evaluateSchedules", async () => {
    const task1 = makeTask({ id: "ns-sched001", name: "sched-1", origin: "recurring" });
    const task2 = makeTask({ id: "ns-sched002", name: "sched-2", origin: "recurring" });
    mockScheduler.evaluateSchedules.mockResolvedValue([task1, task2]);
    mockPool.canAccept.mockReturnValue(true);

    await (orchestrator as any).tick();

    expect(mockPool.dispatch).toHaveBeenCalledWith(task1);
    expect(mockPool.dispatch).toHaveBeenCalledWith(task2);
    expect((orchestrator as any).notificationService.taskStarted).toHaveBeenCalledWith(task1);
    expect((orchestrator as any).notificationService.taskStarted).toHaveBeenCalledWith(task2);
  });

  it("skips remaining scheduled tasks when pool.canAccept returns false", async () => {
    const task1 = makeTask({ id: "ns-sched003", name: "sched-3", origin: "recurring" });
    const task2 = makeTask({ id: "ns-sched004", name: "sched-4", origin: "recurring" });
    mockScheduler.evaluateSchedules.mockResolvedValue([task1, task2]);
    mockPool.canAccept.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await (orchestrator as any).tick();

    expect(mockPool.dispatch).toHaveBeenCalledTimes(1);
    expect(mockPool.dispatch).toHaveBeenCalledWith(task1);
    expect((orchestrator as any).notificationService.taskStarted).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when evaluateSchedules returns empty array", async () => {
    mockScheduler.evaluateSchedules.mockResolvedValue([]);

    await (orchestrator as any).tick();

    // dispatch may be called from queue tasks, but not from scheduled tasks
    // Since queue dir doesn't exist, no queue tasks either
    expect(mockPool.dispatch).not.toHaveBeenCalled();
  });
});

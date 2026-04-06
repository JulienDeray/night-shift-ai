import crypto from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentPool } from "../../src/daemon/agent-pool.js";
import { Logger } from "../../src/core/logger.js";
import type { NightShiftTask } from "../../src/core/types.js";
import type { AgentRunResult } from "../../src/agent/engine-types.js";

// Mock AgentEngine before importing AgentPool
vi.mock("../../src/agent/engine.js", () => ({
  AgentEngine: vi.fn().mockImplementation(() => ({
    run: (...args: unknown[]) => mockEngineRunFn(...args),
  })),
}));

let mockEngineRunFn = vi.fn();

function makeSuccessResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "run-mock",
    agentName: "test-agent",
    status: "SUCCESS",
    finalOutput: null,
    perStep: [],
    totalDurationMs: 100,
    ...overrides,
  };
}

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: crypto.randomUUID(),
    name: "test-task",
    origin: "one-off",
    prompt: "Do something",
    status: "pending",
    timeout: "10m",
    createdAt: new Date().toISOString(),
    agentName: "test-agent",
    ...overrides,
  };
}

describe("AgentPool", () => {
  let pool: AgentPool;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEngineRunFn = vi.fn().mockResolvedValue(makeSuccessResult());
    logger = Logger.createCliLogger(false);
    pool = new AgentPool({
      maxConcurrent: 2,
      workspaceDir: "/tmp/workspace",
      logger,
      configDir: "/tmp/config",
      agentsDir: "./agents",
    });
  });

  describe("canAccept", () => {
    it("returns true when pool is empty", () => {
      expect(pool.canAccept()).toBe(true);
    });

    it("returns true when under maxConcurrent", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000001" }));
      expect(pool.canAccept()).toBe(true);
    });

    it("returns false when at maxConcurrent", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000001" }));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000002" }));
      expect(pool.canAccept()).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("reflects the number of running tasks", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      expect(pool.activeCount).toBe(0);
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000003" }));
      expect(pool.activeCount).toBe(1);
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000004" }));
      expect(pool.activeCount).toBe(2);
    });
  });

  describe("runningTasks", () => {
    it("returns details of all running tasks for status reporting", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000005", agentName: "agent-a" }));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000006", agentName: "agent-b" }));

      const running = pool.runningTasks;
      expect(running).toHaveLength(2);
      expect(running[0]).toMatchObject({ id: "00000000-0000-0000-0000-000000000005", agentName: "agent-a" });
      expect(running[1]).toMatchObject({ id: "00000000-0000-0000-0000-000000000006", agentName: "agent-b" });
      expect(running[0].startedAt).toBeInstanceOf(Date);
    });
  });

  describe("dispatch", () => {
    it("calls engine.run() for a task with agentName", async () => {
      const task = makeTask({ id: "00000000-0000-0000-0000-000000000007", agentName: "test-agent" });
      pool.dispatch(task);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockEngineRunFn).toHaveBeenCalledTimes(1);
    });

    it("immediately pushes a FATAL result for tasks without agentName", async () => {
      const task = makeTask({ id: "00000000-0000-0000-0000-000000000008", agentName: undefined });
      pool.dispatch(task);

      // No async needed — rejected synchronously
      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].result.status).toBe("FATAL");
      expect(completed[0].result.error).toContain("agentName is required");
      expect(mockEngineRunFn).not.toHaveBeenCalled();
    });

    it("logs a warning and does not dispatch when pool is full", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool = new AgentPool({ maxConcurrent: 1, workspaceDir: "/tmp/workspace", logger, configDir: "/tmp/config" });

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000009" }));
      expect(pool.activeCount).toBe(1);

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000a" }));
      expect(pool.activeCount).toBe(1);
    });
  });

  describe("collectCompleted", () => {
    it("returns completed tasks and drains the queue", async () => {
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000b" }));

      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].task.id).toBe("00000000-0000-0000-0000-00000000000b");
      expect(completed[0].result.status).toBe("SUCCESS");

      // Second call should return empty
      const again = pool.collectCompleted();
      expect(again).toHaveLength(0);
    });
  });

  describe("multiple concurrent tasks", () => {
    it("respects maxConcurrent limit — pool full after maxConcurrent dispatches", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool = new AgentPool({ maxConcurrent: 2, workspaceDir: "/tmp/workspace", logger, configDir: "/tmp/config" });

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000c" }));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000d" }));
      expect(pool.canAccept()).toBe(false);

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000e" }));
      expect(pool.activeCount).toBe(2); // third was rejected
    });
  });

  describe("engine failure handling", () => {
    it("produces a FATAL TaskResult when engine.run() rejects", async () => {
      mockEngineRunFn = vi.fn().mockRejectedValue(new Error("Engine crashed"));

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-00000000000f" }));

      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].result.status).toBe("FATAL");
      expect(completed[0].result.error).toContain("Engine crashed");
    });
  });

  describe("drain", () => {
    it("waits for all running tasks and returns results", async () => {
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000010" }));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000011" }));

      const results = await pool.drain();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.result.status === "SUCCESS")).toBe(true);
    });
  });

  describe("killAll", () => {
    it("logs a warning for in-progress tasks (AgentEngine cannot be interrupted)", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000012" }));
      pool.dispatch(makeTask({ id: "00000000-0000-0000-0000-000000000013" }));

      // Should not throw
      expect(() => pool.killAll()).not.toThrow();
    });
  });
});

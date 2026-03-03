import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentPool } from "../../src/daemon/agent-pool.js";
import { Logger } from "../../src/core/logger.js";
import type { NightShiftTask } from "../../src/core/types.js";
import type { AgentRunResult } from "../../src/agent/engine-types.js";

// Mock AgentEngine and BeadRegistry before importing AgentPool
vi.mock("../../src/agent/engine.js", () => ({
  AgentEngine: vi.fn().mockImplementation(() => ({
    run: (...args: unknown[]) => mockEngineRunFn(...args),
  })),
}));

vi.mock("../../src/agent/bead-registry.js", () => ({
  BeadRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  })),
}));

vi.mock("../../src/agent/plugins/standard-bead-plugin.js", () => ({
  StandardBeadPlugin: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../src/agent/plugins/git-clone-bead-plugin.js", () => ({
  GitCloneBeadPlugin: vi.fn().mockImplementation(() => ({})),
}));

let mockEngineRunFn = vi.fn();

function makeSuccessResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "run-mock",
    agentName: "test-agent",
    status: "SUCCESS",
    finalOutput: null,
    perBead: [],
    totalDurationMs: 100,
    ...overrides,
  };
}

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: `ns-${Math.random().toString(16).slice(2, 10)}`,
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
      pool.dispatch(makeTask({ id: "ns-task0001" }));
      expect(pool.canAccept()).toBe(true);
    });

    it("returns false when at maxConcurrent", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool.dispatch(makeTask({ id: "ns-task0001" }));
      pool.dispatch(makeTask({ id: "ns-task0002" }));
      expect(pool.canAccept()).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("reflects the number of running tasks", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      expect(pool.activeCount).toBe(0);
      pool.dispatch(makeTask({ id: "ns-count001" }));
      expect(pool.activeCount).toBe(1);
      pool.dispatch(makeTask({ id: "ns-count002" }));
      expect(pool.activeCount).toBe(2);
    });
  });

  describe("dispatch", () => {
    it("calls engine.run() for a task with agentName", async () => {
      const task = makeTask({ id: "ns-disp0001", agentName: "test-agent" });
      pool.dispatch(task);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockEngineRunFn).toHaveBeenCalledTimes(1);
    });

    it("immediately pushes a FATAL result for tasks without agentName", async () => {
      const task = makeTask({ id: "ns-disp0002", agentName: undefined });
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

      pool.dispatch(makeTask({ id: "ns-full0001" }));
      expect(pool.activeCount).toBe(1);

      pool.dispatch(makeTask({ id: "ns-full0002" }));
      expect(pool.activeCount).toBe(1);
    });
  });

  describe("collectCompleted", () => {
    it("returns completed tasks and drains the queue", async () => {
      pool.dispatch(makeTask({ id: "ns-coll0001" }));

      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].task.id).toBe("ns-coll0001");
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

      pool.dispatch(makeTask({ id: "ns-conc0001" }));
      pool.dispatch(makeTask({ id: "ns-conc0002" }));
      expect(pool.canAccept()).toBe(false);

      pool.dispatch(makeTask({ id: "ns-conc0003" }));
      expect(pool.activeCount).toBe(2); // third was rejected
    });
  });

  describe("engine failure handling", () => {
    it("produces a FATAL TaskResult when engine.run() rejects", async () => {
      mockEngineRunFn = vi.fn().mockRejectedValue(new Error("Engine crashed"));

      pool.dispatch(makeTask({ id: "ns-fail0001" }));

      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].result.status).toBe("FATAL");
      expect(completed[0].result.error).toContain("Engine crashed");
    });
  });

  describe("drain", () => {
    it("waits for all running tasks and returns results", async () => {
      pool.dispatch(makeTask({ id: "ns-drain001" }));
      pool.dispatch(makeTask({ id: "ns-drain002" }));

      const results = await pool.drain();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.result.status === "SUCCESS")).toBe(true);
    });
  });

  describe("killAll", () => {
    it("logs a warning for in-progress tasks (AgentEngine cannot be interrupted)", () => {
      mockEngineRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch(makeTask({ id: "ns-kill0001" }));
      pool.dispatch(makeTask({ id: "ns-kill0002" }));

      // Should not throw
      expect(() => pool.killAll()).not.toThrow();
    });
  });
});

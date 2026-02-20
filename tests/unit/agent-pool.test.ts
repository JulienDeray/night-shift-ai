import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentPool } from "../../src/daemon/agent-pool.js";
import { Logger } from "../../src/core/logger.js";
import type { NightShiftTask } from "../../src/core/types.js";

// Shared mock controls
let mockRunFn = vi.fn();
let mockKillFn = vi.fn();

vi.mock("../../src/daemon/agent-runner.js", () => {
  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      run: (...args: unknown[]) => mockRunFn(...args),
      kill: (...args: unknown[]) => mockKillFn(...args),
    })),
  };
});

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: `ns-${Math.random().toString(16).slice(2, 10)}`,
    name: "test-task",
    origin: "one-off",
    prompt: "Do something",
    status: "pending",
    timeout: "10m",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function successResult() {
  return {
    sessionId: "sess-mock",
    durationMs: 1000,
    totalCostUsd: 0.10,
    result: "Mock result",
    isError: false,
    numTurns: 2,
  };
}

describe("AgentPool", () => {
  let pool: AgentPool;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunFn = vi.fn().mockResolvedValue(successResult());
    mockKillFn = vi.fn();
    logger = Logger.createCliLogger(false);
    pool = new AgentPool({
      maxConcurrent: 2,
      workspaceDir: "/tmp/workspace",
      logger,
    });
  });

  describe("canAccept", () => {
    it("returns true when pool is empty", () => {
      expect(pool.canAccept()).toBe(true);
    });

    it("returns true when under maxConcurrent", () => {
      // Use never-resolving mock so the task stays active
      mockRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool.dispatch(makeTask({ id: "ns-task0001" }));
      expect(pool.canAccept()).toBe(true);
    });

    it("returns false when at maxConcurrent", () => {
      mockRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool.dispatch(makeTask({ id: "ns-task0001" }));
      pool.dispatch(makeTask({ id: "ns-task0002" }));

      expect(pool.canAccept()).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("reflects the number of running tasks", () => {
      mockRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      expect(pool.activeCount).toBe(0);
      pool.dispatch(makeTask({ id: "ns-count001" }));
      expect(pool.activeCount).toBe(1);
      pool.dispatch(makeTask({ id: "ns-count002" }));
      expect(pool.activeCount).toBe(2);
    });
  });

  describe("dispatch", () => {
    it("logs a warning and does not dispatch when pool is full", () => {
      mockRunFn = vi.fn().mockReturnValue(new Promise(() => {}));
      pool = new AgentPool({ maxConcurrent: 1, workspaceDir: "/tmp/workspace", logger });

      pool.dispatch(makeTask({ id: "ns-full0001" }));
      expect(pool.activeCount).toBe(1);

      pool.dispatch(makeTask({ id: "ns-full0002" }));
      expect(pool.activeCount).toBe(1);
    });
  });

  describe("collectCompleted", () => {
    it("returns completed tasks and drains the queue", async () => {
      pool.dispatch(makeTask({ id: "ns-coll0001" }));

      // Wait for the mock to resolve
      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].task.id).toBe("ns-coll0001");
      expect(completed[0].result.isError).toBe(false);

      // Second call should return empty
      const again = pool.collectCompleted();
      expect(again).toHaveLength(0);
    });
  });

  describe("failed agents", () => {
    it("produces a TaskResult with isError=true when agent throws", async () => {
      mockRunFn = vi.fn().mockRejectedValue(new Error("Agent crashed"));

      pool.dispatch(makeTask({ id: "ns-fail0001" }));

      // Wait for the rejection handler
      await new Promise((r) => setTimeout(r, 50));

      const completed = pool.collectCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].result.isError).toBe(true);
      expect(completed[0].result.result).toContain("Agent crashed");
    });
  });

  describe("drain", () => {
    it("waits for all running tasks and returns results", async () => {
      pool.dispatch(makeTask({ id: "ns-drain001" }));
      pool.dispatch(makeTask({ id: "ns-drain002" }));

      const results = await pool.drain();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.result.sessionId === "sess-mock")).toBe(true);
    });
  });

  describe("killAll", () => {
    it("sends kill signal to all running agents", () => {
      mockRunFn = vi.fn().mockReturnValue(new Promise(() => {}));

      pool.dispatch(makeTask({ id: "ns-kill0001" }));
      pool.dispatch(makeTask({ id: "ns-kill0002" }));

      pool.killAll();
      expect(mockKillFn).toHaveBeenCalledTimes(2);
    });
  });
});

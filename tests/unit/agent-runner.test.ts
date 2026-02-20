import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRunner, type AgentRunnerOptions } from "../../src/daemon/agent-runner.js";
import { Logger } from "../../src/core/logger.js";
import { AgentExecutionError } from "../../src/core/errors.js";
import type { NightShiftTask, ClaudeJsonOutput } from "../../src/core/types.js";

// Mock spawnWithTimeout at the module level
const mockSpawnResult = {
  stdout: "",
  stderr: "",
  exitCode: 0 as number | null,
  timedOut: false,
};

const mockProcess = {
  killed: false,
  kill: vi.fn(),
};

vi.mock("../../src/utils/process.js", () => ({
  spawnWithTimeout: vi.fn((_bin: string, _args: string[], _opts: unknown) => ({
    process: mockProcess,
    result: Promise.resolve(mockSpawnResult),
  })),
  parseTimeout: vi.fn((s: string) => {
    const match = s.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) return 30 * 60 * 1000;
    const [, val, unit] = match;
    const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
    return parseInt(val) * (multipliers[unit] ?? 60000);
  }),
}));

function makeTask(overrides: Partial<NightShiftTask> = {}): NightShiftTask {
  return {
    id: "ns-test1234",
    name: "test-task",
    origin: "one-off",
    prompt: "Say hello",
    status: "pending",
    timeout: "10m",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaudeOutput(overrides: Partial<ClaudeJsonOutput> = {}): ClaudeJsonOutput {
  return {
    session_id: "sess-123",
    duration_ms: 5000,
    total_cost_usd: 0.15,
    result: "Hello! I've completed the task.",
    is_error: false,
    num_turns: 3,
    ...overrides,
  };
}

describe("AgentRunner", () => {
  let runner: AgentRunner;
  let logger: Logger;
  let opts: AgentRunnerOptions;
  let spawnWithTimeout: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnResult.stdout = "";
    mockSpawnResult.stderr = "";
    mockSpawnResult.exitCode = 0;
    mockSpawnResult.timedOut = false;
    mockProcess.killed = false;

    logger = Logger.createCliLogger(false);
    opts = { workspaceDir: "/tmp/workspace", logger };
    runner = new AgentRunner(opts);

    const mod = await import("../../src/utils/process.js");
    spawnWithTimeout = mod.spawnWithTimeout as unknown as ReturnType<typeof vi.fn>;
  });

  describe("buildArgs (tested via spawn call)", () => {
    it("passes basic required arguments", async () => {
      const task = makeTask();
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      expect(spawnWithTimeout).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "-p",
          "Say hello",
          "--output-format",
          "json",
          "--dangerously-skip-permissions",
          "--no-session-persistence",
        ]),
        expect.objectContaining({ cwd: "/tmp/workspace" }),
      );
    });

    it("includes --allowedTools when specified", async () => {
      const task = makeTask({ allowedTools: ["Read", "Write", "Bash"] });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      const toolsIdx = args.indexOf("--allowedTools");
      expect(toolsIdx).toBeGreaterThan(-1);
      expect(args[toolsIdx + 1]).toBe("Read");
      expect(args[toolsIdx + 2]).toBe("Write");
      expect(args[toolsIdx + 3]).toBe("Bash");
    });

    it("includes --max-budget-usd when specified", async () => {
      const task = makeTask({ maxBudgetUsd: 5.0 });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      const budgetIdx = args.indexOf("--max-budget-usd");
      expect(budgetIdx).toBeGreaterThan(-1);
      expect(args[budgetIdx + 1]).toBe("5");
    });

    it("includes --model when specified", async () => {
      const task = makeTask({ model: "opus" });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      expect(args).toContain("--model");
      expect(args[args.indexOf("--model") + 1]).toBe("opus");
    });

    it("includes --mcp-config when specified", async () => {
      const task = makeTask({ mcpConfig: "/path/to/mcp.json" });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      expect(args).toContain("--mcp-config");
      expect(args[args.indexOf("--mcp-config") + 1]).toBe("/path/to/mcp.json");
    });

    it("includes --append-system-prompt with task name and workspace", async () => {
      const task = makeTask({ name: "my-task" });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      expect(args).toContain("--append-system-prompt");
      const promptIdx = args.indexOf("--append-system-prompt");
      expect(args[promptIdx + 1]).toContain("my-task");
      expect(args[promptIdx + 1]).toContain("/tmp/workspace");
    });

    it("omits optional flags when fields are absent", async () => {
      const task = makeTask({
        allowedTools: undefined,
        maxBudgetUsd: undefined,
        model: undefined,
        mcpConfig: undefined,
      });
      mockSpawnResult.stdout = JSON.stringify(makeClaudeOutput());

      await runner.run(task);

      const args = spawnWithTimeout.mock.calls[0][1] as string[];
      expect(args).not.toContain("--allowedTools");
      expect(args).not.toContain("--max-budget-usd");
      expect(args).not.toContain("--model");
      expect(args).not.toContain("--mcp-config");
    });
  });

  describe("parseOutput", () => {
    it("parses valid claude JSON output", async () => {
      const claudeOutput = makeClaudeOutput({
        session_id: "sess-abc",
        duration_ms: 12000,
        total_cost_usd: 0.42,
        result: "Task completed successfully.",
        is_error: false,
        num_turns: 8,
      });
      mockSpawnResult.stdout = JSON.stringify(claudeOutput);

      const result = await runner.run(makeTask());

      expect(result.sessionId).toBe("sess-abc");
      expect(result.durationMs).toBe(12000);
      expect(result.totalCostUsd).toBe(0.42);
      expect(result.result).toBe("Task completed successfully.");
      expect(result.isError).toBe(false);
      expect(result.numTurns).toBe(8);
    });

    it("throws AgentExecutionError on malformed JSON", async () => {
      mockSpawnResult.stdout = "not valid json {{{";

      await expect(runner.run(makeTask())).rejects.toThrow(AgentExecutionError);
    });

    it("throws AgentExecutionError on empty output", async () => {
      mockSpawnResult.stdout = "";

      await expect(runner.run(makeTask())).rejects.toThrow(AgentExecutionError);
    });
  });

  describe("error handling", () => {
    it("returns error result on timeout", async () => {
      mockSpawnResult.timedOut = true;
      mockSpawnResult.exitCode = null;

      const result = await runner.run(makeTask({ timeout: "5m" }));

      expect(result.isError).toBe(true);
      expect(result.result).toContain("timed out");
      expect(result.numTurns).toBe(0);
    });

    it("throws on non-zero exit code", async () => {
      mockSpawnResult.exitCode = 1;
      mockSpawnResult.stderr = "claude: error: something broke";

      await expect(runner.run(makeTask())).rejects.toThrow(AgentExecutionError);
    });

    it("includes stderr in error message on non-zero exit", async () => {
      mockSpawnResult.exitCode = 1;
      mockSpawnResult.stderr = "specific error details";

      try {
        await runner.run(makeTask());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AgentExecutionError);
        expect((err as Error).message).toContain("specific error details");
      }
    });
  });

  describe("kill", () => {
    it("sends SIGTERM to the running process", async () => {
      // Set up a never-resolving promise to simulate a running task
      const neverResolves = new Promise<never>(() => {});
      spawnWithTimeout.mockReturnValue({
        process: mockProcess,
        result: neverResolves,
      });

      // Start the task but don't await
      const runPromise = runner.run(makeTask());

      // Give it a tick to set this.process
      await new Promise((r) => setTimeout(r, 10));

      runner.kill();
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");

      // Clean up - prevent unhandled promise rejection
      runPromise.catch(() => {});
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock spawnWithTimeout before importing
vi.mock("../../src/utils/process.js", () => ({
  spawnWithTimeout: vi.fn(),
  parseTimeout: vi.fn(() => 30000),
}));

import { runBead, buildBeadEnv, buildBeadArgs } from "../../src/agent/bead-runner.js";
import { spawnWithTimeout } from "../../src/utils/process.js";

const mockSpawn = vi.mocked(spawnWithTimeout);

describe("runBead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts result field from Claude CLI JSON envelope", async () => {
    const agentResult = '```json\n{"status": "PASSED"}\n```\n\nAll checks passed.';
    const cliEnvelope = JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "sess-1",
      is_error: false,
      duration_ms: 5000,
      total_cost_usd: 0.01,
      num_turns: 3,
      result: agentResult,
    });

    mockSpawn.mockReturnValue({
      result: Promise.resolve({
        exitCode: 0,
        stdout: cliEnvelope,
        stderr: "",
        timedOut: false,
      }),
      kill: vi.fn(),
    });

    const result = await runBead({
      beadName: "preflight",
      prompt: "test prompt",
      model: "sonnet",
      cwd: "/tmp",
      timeoutMs: 30000,
    });

    expect(result.stdout).toBe(agentResult);
    expect(result.stdout).toContain("```json");
    expect(result.costUsd).toBe(0.01);
    expect(result.durationMs).toBe(5000);
  });

  it("returns raw stdout when CLI output is not valid JSON", async () => {
    const rawOutput = "plain text output";

    mockSpawn.mockReturnValue({
      result: Promise.resolve({
        exitCode: 0,
        stdout: rawOutput,
        stderr: "",
        timedOut: false,
      }),
      kill: vi.fn(),
    });

    const result = await runBead({
      beadName: "preflight",
      prompt: "test prompt",
      model: "sonnet",
      cwd: "/tmp",
      timeoutMs: 30000,
    });

    expect(result.stdout).toBe(rawOutput);
  });

  it("returns raw stdout on non-zero exit code", async () => {
    mockSpawn.mockReturnValue({
      result: Promise.resolve({
        exitCode: 1,
        stdout: "error output",
        stderr: "something failed",
        timedOut: false,
      }),
      kill: vi.fn(),
    });

    const result = await runBead({
      beadName: "preflight",
      prompt: "test prompt",
      model: "sonnet",
      cwd: "/tmp",
      timeoutMs: 30000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("error output");
  });
});

describe("buildBeadEnv", () => {
  it("includes GITLAB_TOKEN when provided", () => {
    const env = buildBeadEnv("test", "token-123");
    expect(env.GITLAB_TOKEN).toBe("token-123");
  });

  it("excludes GITLAB_TOKEN when undefined", () => {
    const env = buildBeadEnv("test", undefined);
    expect(env.GITLAB_TOKEN).toBeUndefined();
  });
});

describe("buildBeadArgs", () => {
  it("includes --output-format json flag", () => {
    const args = buildBeadArgs("prompt", "sonnet");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("includes --mcp-config when mcpConfigPath provided", () => {
    const args = buildBeadArgs("prompt", "sonnet", undefined, {
      mcpConfigPath: "/path/to/mcp.json",
    });
    expect(args).toContain("--mcp-config");
    expect(args).toContain("/path/to/mcp.json");
  });
});

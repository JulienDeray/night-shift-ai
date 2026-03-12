import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// Mock runBead before importing the module under test
vi.mock("../../src/agent/bead-runner.js", () => ({
  runBead: vi.fn(),
  buildBeadEnv: vi.fn(),
}));

import { runBead } from "../../src/agent/bead-runner.js";
import { StandardBeadPlugin } from "../../src/agent/plugins/standard-bead-plugin.js";
import { INJECTION_MITIGATION_PREAMBLE } from "../../src/agent/prompt-loader.js";
import type { AgentPipelineContext } from "../../src/agent/bead-plugin.js";
import type { ResolvedBead, LoadedManifest } from "../../src/agent/manifest-types.js";

const mockRunBead = vi.mocked(runBead);

// Minimal compiled schema for test beads
const MINIMAL_SCHEMA = z.fromJSONSchema({
  type: "object",
  properties: { result: { type: "string" } },
}) as z.ZodTypeAny;

function makeResolvedBead(overrides: Partial<ResolvedBead> = {}): ResolvedBead {
  return {
    name: "analyze",
    type: "standard",
    prompt: "prompts/analyze.md",
    model: "claude-sonnet-4-5",
    timeout: "15m",
    allowedTools: ["Bash", "Read", "Write"],
    env: [],
    outputSchema: {},
    compiledOutputSchema: MINIMAL_SCHEMA,
    ...overrides,
  };
}

function makeManifest(agentDir: string): LoadedManifest {
  return {
    name: "test-agent",
    description: "Test agent",
    agentDir,
    variables: {},
    beads: [],
  };
}

function makeContext(
  agentDir: string,
  overrides: Partial<AgentPipelineContext> = {},
): AgentPipelineContext {
  const bead = overrides.currentBead ?? makeResolvedBead();
  return {
    taskId: "task-123",
    agentName: "test-agent",
    agentDir,
    workDir: "/tmp/work",
    handoffDir: "/tmp/handoff",
    manifest: makeManifest(agentDir),
    currentBead: bead,
    previousBeads: {},
    variables: { task_id: "task-123", repo_path: "/tmp/repo" },
    ...overrides,
  };
}

describe("StandardBeadPlugin", () => {
  let agentDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-agent-"));
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Analyze the repository at {{repo_path}} for task {{task_id}}.",
    );
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns rawOutput from runBead result on success", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: '{"summary": "all good"}',
      stderr: "",
      durationMs: 1000,
      costUsd: 0.01,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir);
    const result = await plugin.execute(ctx);

    expect(result).toEqual({ rawOutput: '{"summary": "all good"}' });
  });

  it("renders template placeholders in the prompt before passing to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      durationMs: 500,
      costUsd: 0.005,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir, {
      variables: { task_id: "abc-456", repo_path: "/home/user/code" },
    });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.prompt).toContain("/home/user/code");
    expect(callArgs.prompt).toContain("abc-456");
    expect(callArgs.prompt).not.toContain("{{repo_path}}");
    expect(callArgs.prompt).not.toContain("{{task_id}}");
  });

  it("throws when runBead returns non-zero exit code", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "claude: internal error",
      durationMs: 200,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir);

    await expect(plugin.execute(ctx)).rejects.toThrow(/exit code 1/);
  });

  it("throws when runBead result indicates timeout", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: 900000,
      costUsd: 0,
      timedOut: true,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir);

    await expect(plugin.execute(ctx)).rejects.toThrow(/timed out/);
  });

  it("forwards all bead env vars to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const bead = makeResolvedBead({
      env: [
        { name: "GITLAB_TOKEN", value: "my-secret-token" },
        { name: "BAMBOOHR_API_KEY", value: "bamboo-key" },
      ],
    });
    const ctx = makeContext(agentDir, { currentBead: bead });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.envVars).toEqual([
      { name: "GITLAB_TOKEN", value: "my-secret-token" },
      { name: "BAMBOOHR_API_KEY", value: "bamboo-key" },
    ]);
  });

  it("passes empty envVars when bead has no env entries", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir);
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.envVars).toEqual([]);
  });

  it("passes allowedTools and model from currentBead to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const bead = makeResolvedBead({
      model: "claude-opus-4",
      allowedTools: ["Bash", "Read"],
    });
    const ctx = makeContext(agentDir, { currentBead: bead });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-opus-4");
    expect(callArgs.allowedTools).toEqual(["Bash", "Read"]);
  });

  it("prepends INJECTION_MITIGATION_PREAMBLE to the prompt passed to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const ctx = makeContext(agentDir);
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.prompt.startsWith(INJECTION_MITIGATION_PREAMBLE)).toBe(true);
  });

  it("passes mcpConfigPath resolved from template variable to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const bead = makeResolvedBead({ mcpConfig: "{{mcp_config_path}}" });
    const ctx = makeContext(agentDir, {
      currentBead: bead,
      variables: { task_id: "task-123", repo_path: "/tmp/repo", mcp_config_path: "/tmp/mcp.json" },
    });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    // Template variable rendered to absolute path — used directly
    expect(callArgs.mcpConfigPath).toBe("/tmp/mcp.json");
  });

  it("passes mcpConfigPath resolved from relative literal path to runBead", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const bead = makeResolvedBead({ mcpConfig: "mcp-config.json" });
    const ctx = makeContext(agentDir, { currentBead: bead });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.mcpConfigPath).toBe(path.join(agentDir, "mcp-config.json"));
  });

  it("does not pass mcpConfigPath when mcpConfig is undefined", async () => {
    mockRunBead.mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 100,
      costUsd: 0,
      timedOut: false,
    });

    const plugin = new StandardBeadPlugin();
    const bead = makeResolvedBead({ mcpConfig: undefined });
    const ctx = makeContext(agentDir, { currentBead: bead });
    await plugin.execute(ctx);

    const callArgs = mockRunBead.mock.calls[0][0];
    expect(callArgs.mcpConfigPath).toBeUndefined();
  });
});

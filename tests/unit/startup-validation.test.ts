import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { NightShiftConfig } from "../../src/core/types.js";
import { NightShiftError } from "../../src/core/errors.js";

// ---------------------------------------------------------------------------
// Mock loadManifest
// ---------------------------------------------------------------------------

vi.mock("../../src/agent/manifest-loader.js", () => ({
  loadManifest: vi.fn(),
}));

import { loadManifest } from "../../src/agent/manifest-loader.js";
import { validateAgentsAtStartup } from "../../src/daemon/orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal compiled output schema for use in mock manifests.
 */
const MINIMAL_OUTPUT_SCHEMA = z.fromJSONSchema({
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
}) as z.ZodTypeAny;

/**
 * Builds a minimal NightShiftConfig with sensible defaults.
 */
function makeConfig(overrides: Partial<NightShiftConfig> = {}): NightShiftConfig {
  return {
    workspace: "./workspace",
    inbox: "./inbox",
    maxConcurrent: 2,
    defaultTimeout: "15m",
    daemon: { pollIntervalMs: 30000, heartbeatIntervalMs: 60000, logRetentionDays: 7 },
    agentsDir: "./agents",
    agents: [],
    schedule: [],
    oneOffDefaults: { timeout: "15m" },
    ...overrides,
  };
}

/**
 * Builds a minimal LoadedManifest mock.
 */
function makeLoadedManifest(
  agentDir: string,
  options: {
    name?: string;
    variables?: Record<string, string>;
    steps?: Array<{ name: string; prompt: string }>;
  } = {},
) {
  const { name = "test-agent", variables = {}, steps = [{ name: "analyze", prompt: "prompts/analyze.md" }] } =
    options;
  return {
    name,
    description: "A test agent",
    agentDir,
    variables,
    steps: steps.map((s) => ({
      name: s.name,
      prompt: s.prompt,
      model: "claude-sonnet-4-20250514",
      timeout: "15m",
      allowedTools: ["Bash", "Read", "Write"],
      env: [],
      outputSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
      compiledOutputSchema: MINIMAL_OUTPUT_SCHEMA,
    })),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-startup-test-"));
  vi.mocked(loadManifest).mockReset();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateAgentsAtStartup", () => {
  // 1. No-op when agents array is empty
  it("no-op when agents array is empty", async () => {
    const config = makeConfig({ agents: [], schedule: [] });
    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
    expect(vi.mocked(loadManifest)).not.toHaveBeenCalled();
  });

  // 2. Passes when all manifests are valid
  it("passes when all manifests are valid", async () => {
    const agentDir = path.join(tmpDir, "agents", "my-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await fs.writeFile(path.join(agentDir, "prompts", "analyze.md"), "No placeholders here.");

    vi.mocked(loadManifest).mockResolvedValue(makeLoadedManifest(agentDir));

    const config = makeConfig({
      agents: [{ name: "my-agent" }],
      schedule: [],
    });
    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 3. Fails when agent directory does not exist (loadManifest throws)
  it("fails when agent directory does not exist", async () => {
    vi.mocked(loadManifest).mockRejectedValue(
      new NightShiftError("Cannot read manifest at /nonexistent/agent/manifest.yaml: ENOENT", "MANIFEST"),
    );

    const config = makeConfig({
      agents: [{ name: "missing-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("missing-agent");
    expect(err.message).toContain("Startup validation failed");
  });

  // 4. Fails when manifest has invalid schema (loadManifest throws ManifestError)
  it("fails when manifest has invalid schema", async () => {
    vi.mocked(loadManifest).mockRejectedValue(
      new NightShiftError("Manifest validation failed:\n  manifest.yaml: name: Required", "MANIFEST"),
    );

    const config = makeConfig({
      agents: [{ name: "broken-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("broken-agent");
    expect(err.message).toContain("Manifest validation failed");
  });

  // 5. Fails when prompt file is missing
  it("fails when prompt file is missing", async () => {
    const agentDir = path.join(tmpDir, "agents", "missing-prompt-agent");
    await fs.mkdir(agentDir, { recursive: true });
    // Note: we do NOT create the prompt file

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "missing-prompt-agent",
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "missing-prompt-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("prompt file not found");
    expect(err.message).toContain("analyze");
  });

  // 6. Fails when template variable is undefined
  it("fails when template variable is undefined", async () => {
    const agentDir = path.join(tmpDir, "agents", "undefined-var-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    // Prompt references {{custom_var}} but it's not declared anywhere
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Process this: {{custom_var}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "undefined-var-agent",
        variables: {}, // custom_var NOT present
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "undefined-var-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("undefined variables");
    expect(err.message).toContain("custom_var");
  });

  // 7. Passes when template variable is provided in manifest defaults
  it("passes when template variable is provided in manifest defaults", async () => {
    const agentDir = path.join(tmpDir, "agents", "manifest-var-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Process this: {{custom_var}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "manifest-var-agent",
        variables: { custom_var: "default-value" }, // provided in manifest
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "manifest-var-agent" }],
      schedule: [],
    });

    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 8. Passes when template variable is provided in agent-level config overrides
  it("passes when template variable is provided in agent-level config overrides", async () => {
    const agentDir = path.join(tmpDir, "agents", "config-var-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Process this: {{custom_var}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "config-var-agent",
        variables: {}, // NOT in manifest
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      // Agent-level config override provides the variable
      agents: [{ name: "config-var-agent", variables: { custom_var: "from-config" } }],
      schedule: [],
    });

    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 9. Passes when template variable is provided in schedule-level overrides
  it("passes when template variable is provided in schedule-level overrides", async () => {
    const agentDir = path.join(tmpDir, "agents", "schedule-var-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Process this: {{custom_var}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "schedule-var-agent",
        variables: {}, // NOT in manifest
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "schedule-var-agent" }],
      // Schedule-level override provides the variable
      schedule: [
        {
          agent: "schedule-var-agent",
          cron: "0 2 * * *",
          enabled: true,
          variables: { custom_var: "from-schedule" },
        },
      ],
    });

    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 10. Built-in variables are recognized
  it("built-in variables are recognized", async () => {
    const agentDir = path.join(tmpDir, "agents", "builtin-var-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    // Prompt uses built-in vars — should NOT require explicit declaration
    await fs.writeFile(
      path.join(agentDir, "prompts", "analyze.md"),
      "Task {{task_id}} on {{run_date}} for agent {{agent_name}} at {{repo_path}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "builtin-var-agent",
        variables: {},
        steps: [{ name: "analyze", prompt: "prompts/analyze.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "builtin-var-agent" }],
      schedule: [],
    });

    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 11. steps.* variables are skipped at startup
  it("steps.* variables are skipped at startup", async () => {
    const agentDir = path.join(tmpDir, "agents", "step-ref-agent");
    await fs.mkdir(path.join(agentDir, "prompts"), { recursive: true });
    // steps.* references are only resolved at runtime — skip validation
    await fs.writeFile(
      path.join(agentDir, "prompts", "verify.md"),
      "Verify this result: {{steps.analyze.output.result}}",
    );

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "step-ref-agent",
        variables: {},
        steps: [{ name: "verify", prompt: "prompts/verify.md" }],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "step-ref-agent" }],
      schedule: [],
    });

    await expect(validateAgentsAtStartup(config, tmpDir)).resolves.toBeUndefined();
  });

  // 12. Collects errors from multiple agents
  it("collects errors from multiple agents", async () => {
    vi.mocked(loadManifest)
      .mockRejectedValueOnce(new NightShiftError("Cannot read manifest for agent-one", "MANIFEST"))
      .mockRejectedValueOnce(new NightShiftError("Cannot read manifest for agent-two", "MANIFEST"));

    const config = makeConfig({
      agents: [{ name: "agent-one" }, { name: "agent-two" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("2 error(s)");
    expect(err.message).toContain("agent-one");
    expect(err.message).toContain("agent-two");
  });

  // 13. Collects errors from multiple steps in same agent
  it("collects errors from multiple steps in same agent", async () => {
    const agentDir = path.join(tmpDir, "agents", "multi-step-agent");
    await fs.mkdir(agentDir, { recursive: true });
    // Neither prompt file exists — both steps should fail

    vi.mocked(loadManifest).mockResolvedValue(
      makeLoadedManifest(agentDir, {
        name: "multi-step-agent",
        steps: [
          { name: "analyze", prompt: "prompts/analyze.md" },
          { name: "verify", prompt: "prompts/verify.md" },
        ],
      }),
    );

    const config = makeConfig({
      agents: [{ name: "multi-step-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("analyze");
    expect(err.message).toContain("verify");
    expect(err.message).toContain("prompt file not found");
  });

  // 14. Env var check is delegated to loadManifest
  it("env var check is delegated to loadManifest", async () => {
    vi.mocked(loadManifest).mockRejectedValue(
      new NightShiftError(
        'env var "REQUIRED_TOKEN" (passthrough) is not set in the host environment',
        "MANIFEST",
      ),
    );

    const config = makeConfig({
      agents: [{ name: "env-var-agent" }],
      schedule: [],
    });

    const err = await validateAgentsAtStartup(config, tmpDir).catch((e) => e);
    expect(err).toBeInstanceOf(NightShiftError);
    expect((err as NightShiftError).code).toBe("CONFIG");
    expect(err.message).toContain("env-var-agent");
    expect(err.message).toContain("REQUIRED_TOKEN");
  });
});

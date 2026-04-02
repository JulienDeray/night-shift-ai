import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Mock spawnWithTimeout to avoid real subprocess invocations
// ---------------------------------------------------------------------------

vi.mock("../../src/utils/process.js", () => ({
  spawnWithTimeout: vi.fn(),
  parseTimeout: vi.fn((t: string | undefined) => {
    if (!t) return 900_000;
    const m = t.match(/^(\d+)m$/);
    if (m) return parseInt(m[1], 10) * 60_000;
    return 900_000;
  }),
}));

import { spawnWithTimeout } from "../../src/utils/process.js";
import { AgentEngine } from "../../src/agent/engine.js";
import { Logger } from "../../src/core/logger.js";
import { NightShiftError } from "../../src/core/errors.js";

const mockSpawn = vi.mocked(spawnWithTimeout);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal StepResult shape (successful case). */
function makeSpawnResult(stdout: string, overrides: Record<string, unknown> = {}) {
  return {
    result: Promise.resolve({
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
      ...overrides,
    }),
    kill: vi.fn(),
  };
}

/** Wraps output in a Claude CLI JSON envelope so the step runner extracts it. */
function cliEnvelope(result: string): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "sess-test",
    is_error: false,
    duration_ms: 1000,
    total_cost_usd: 0.001,
    num_turns: 1,
    result,
  });
}

/** JSON block that satisfies RESULT_OUTPUT_SCHEMA. */
const VALID_RESULT_OUTPUT = '```json\n{"result":"ok"}\n```';

/** Minimal outputSchema JSON for a standard step requiring { result: string }. */
const RESULT_OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
};

/**
 * Creates a temporary agent directory with a valid manifest and prompt files.
 *
 * Returns paths to agentsRoot and agentDir.
 * The returned cleanup() removes the entire tmpDir.
 */
async function createTempAgent(options?: {
  agentName?: string;
  steps?: Array<{
    name: string;
    prompt: string;
    outputSchema?: Record<string, unknown>;
    retry?: { maxAttempts: number; retryFrom: string };
    earlyExit?: { when: Record<string, unknown>; reason?: string };
  }>;
  promptContents?: Record<string, string>;
}): Promise<{
  agentsRoot: string;
  agentDir: string;
  cleanup: () => Promise<void>;
}> {
  const agentName = options?.agentName ?? "test-agent";
  const steps = options?.steps ?? [
    {
      name: "analyze",
      prompt: "prompts/analyze.md",
      outputSchema: RESULT_OUTPUT_SCHEMA,
    },
  ];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-engine-test-"));
  const agentsRoot = path.join(tmpDir, "agents");
  const agentDir = path.join(agentsRoot, agentName);
  const promptsDir = path.join(agentDir, "prompts");
  await fs.mkdir(promptsDir, { recursive: true });

  // Write manifest
  const manifest = {
    name: agentName,
    description: "Test agent for engine unit tests",
    steps,
  };
  await fs.writeFile(
    path.join(agentDir, "manifest.yaml"),
    stringifyYaml(manifest),
  );

  // Write prompt files
  for (const step of steps) {
    const promptPath = path.join(agentDir, step.prompt);
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    const content =
      options?.promptContents?.[step.prompt] ??
      `Analyze the repository for task {{task_id}}.`;
    await fs.writeFile(promptPath, content);
  }

  return {
    agentsRoot,
    agentDir,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
  };
}

/** Creates a Logger that silences all output. */
function silentLogger(): Logger {
  return new Logger({ minLevel: "error", stdout: false });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("AgentEngine", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (cleanup) {
      await cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Successful pipeline execution
  // -------------------------------------------------------------------------

  describe("successful pipeline execution", () => {
    it("single-step pipeline returns SUCCESS result with finalOutput", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      expect(result.status).toBe("SUCCESS");
      expect(result.perStep).toHaveLength(1);
      expect(result.perStep[0].status).toBe("SUCCESS");
      expect(result.finalOutput).toEqual({ result: "ok" });
      expect(result.agentName).toBe("test-agent");
    });

    it("returns totalDurationMs greater than or equal to 0", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("runId is a valid UUID", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      // UUID v4 pattern
      expect(result.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("multi-step pipeline: second step receives first step output in template vars", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "analyze",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "implement",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/analyze.md": "Analyze for task {{task_id}}.",
          "prompts/implement.md":
            "Implement based on analysis: {{steps.analyze.output.result}}.",
        },
      });
      cleanup = c;

      // Both steps succeed
      mockSpawn
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"result":"analysis-done"}\n```')))
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-multi");

      expect(result.status).toBe("SUCCESS");
      expect(result.perStep).toHaveLength(2);
      expect(result.perStep[0].status).toBe("SUCCESS");
      expect(result.perStep[1].status).toBe("SUCCESS");

      // Verify template substitution happened: second spawn call args array
      // should include the rendered prompt with first step's output value
      const secondCallArgs = mockSpawn.mock.calls[1];
      // secondCallArgs[1] is the args array: ["-p", renderedPrompt, ...]
      const argsStr = JSON.stringify(secondCallArgs[1]);
      expect(argsStr).toContain("analysis-done");
      expect(argsStr).not.toContain("{{steps.analyze.output.result}}");
    });

    it("temp directory is cleaned up after successful run", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-cleanup");

      // Scan tmp for the nightshift-{runId} directory — it should be gone
      const runId = result.runId;
      const tmpPath = path.join(os.tmpdir(), `nightshift-${runId}`);
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Step failure and rollback
  // -------------------------------------------------------------------------

  describe("step failure and rollback", () => {
    it("fails on second step: first step SUCCESS, second FAILED, third SKIPPED", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "step-one",
            prompt: "prompts/step-one.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "step-two",
            prompt: "prompts/step-two.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "step-three",
            prompt: "prompts/step-three.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/step-one.md": "Step one.",
          "prompts/step-two.md": "Step two.",
          "prompts/step-three.md": "Step three.",
        },
      });
      cleanup = c;

      mockSpawn
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"result":"step-one"}\n```')))
        .mockReturnValueOnce(makeSpawnResult("", { exitCode: 1, stderr: "step-two exploded" }));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-fail");

      expect(result.failedStepIndex).toBe(1);
      expect(result.perStep).toHaveLength(3);
      expect(result.perStep[0].status).toBe("SUCCESS");
      expect(result.perStep[1].status).toBe("FAILED");
      expect(result.perStep[2].status).toBe("SKIPPED");
      expect(result.error).toContain("step-two");
      expect(result.finalOutput).toBeNull();
    });

    it("temp directory is cleaned up after step failure (rollback)", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult("", { exitCode: 1, stderr: "step execution failed" }));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-rollback");

      const tmpPath = path.join(os.tmpdir(), `nightshift-${result.runId}`);
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });

    it("does not throw — returns result even when step fails", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult("", { exitCode: 1, stderr: "unexpected error" }));

      const engine = new AgentEngine(silentLogger());
      // Must not throw
      const result = await engine.run(agentDir, agentsRoot, "task-no-throw");
      expect(result.status).not.toBe("SUCCESS");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Error categorization
  // -------------------------------------------------------------------------

  describe("error categorization", () => {
    it("StepOutputMissingError categorized as TRANSIENT", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      // Return output with no JSON block so validateStepOutput throws StepOutputMissingError
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope("No JSON block here, just narrative text.")));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-missing");

      expect(result.status).toBe("TRANSIENT");
      expect(result.errorCategory).toBe("TRANSIENT");
      expect(result.suggestedDelayMs).toBe(60_000);
    });

    it("StepContractViolationError categorized as TRANSIENT", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      // Return wrong schema: { wrong: "field" } instead of { result: "..." }
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope('```json\n{"wrong":"field"}\n```')));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-contract");

      expect(result.status).toBe("TRANSIENT");
      expect(result.errorCategory).toBe("TRANSIENT");
      expect(result.suggestedDelayMs).toBe(60_000);
    });

    it("generic Error (non-zero exit) categorized as FATAL (safe default)", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockSpawn.mockReturnValue(makeSpawnResult("", { exitCode: 1, stderr: "something unexpected" }));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-generic");

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
      expect(result.suggestedDelayMs).toBeUndefined();
    });

    it("TRANSIENT result has suggestedDelayMs of 60000ms", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      // Return plain text with no JSON block → StepOutputMissingError → TRANSIENT
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope("No JSON here.")));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-delay");

      expect(result.suggestedDelayMs).toBe(60_000);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Output schema validation
  // -------------------------------------------------------------------------

  describe("output schema validation", () => {
    it("step output not matching schema: StepContractViolationError treated as TRANSIENT failure", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "analyze",
            prompt: "prompts/analyze.md",
            outputSchema: {
              type: "object",
              properties: { result: { type: "string" } },
              required: ["result"],
            },
          },
        ],
      });
      cleanup = c;

      // Returns wrong schema: { wrong: "field" } instead of { result: "..." }
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope('```json\n{"wrong":"field"}\n```')));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-schema");

      expect(result.status).toBe("TRANSIENT");
      expect(result.perStep[0].status).toBe("FAILED");
    });

    it("step returning no JSON block: StepOutputMissingError treated as TRANSIENT failure", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;

      // Returns plain text with no JSON block
      mockSpawn.mockReturnValue(makeSpawnResult(cliEnvelope("No JSON here, just a narrative.")));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-no-json");

      expect(result.status).toBe("TRANSIENT");
      expect(result.perStep[0].status).toBe("FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Manifest load failure
  // -------------------------------------------------------------------------

  describe("manifest load failure", () => {
    it("non-existent agent directory returns FATAL result (does not throw)", async () => {
      const engine = new AgentEngine(silentLogger());

      const result = await engine.run(
        "/tmp/non-existent-agent-dir",
        "/tmp",
        "task-missing-agent",
      );

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
      expect(result.finalOutput).toBeNull();
      expect(result.perStep).toHaveLength(0);
    });

    it("manifest load failure still cleans up temp dir", async () => {
      const engine = new AgentEngine(silentLogger());

      const result = await engine.run(
        "/tmp/non-existent-agent-dir-cleanup",
        "/tmp",
        "task-cleanup-on-fail",
      );

      const tmpPath = path.join(os.tmpdir(), `nightshift-${result.runId}`);
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Dry-run mode
  // -------------------------------------------------------------------------

  describe("dryRun()", () => {
    it("valid agent directory completes without error", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;

      const engine = new AgentEngine(silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).resolves.toBeUndefined();
    });

    it("throws when prompt file is missing", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "analyze",
            prompt: "prompts/missing-file.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        // Don't create the prompt file
        promptContents: {},
      });
      cleanup = c;

      // Write the manifest with a reference to a non-existent prompt file
      // The createTempAgent helper creates files for all steps so we delete one
      const promptPath = path.join(agentDir, "prompts", "missing-file.md");
      await fs.unlink(promptPath).catch(() => {});

      const engine = new AgentEngine(silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toThrow();
    });

    it("throws ManifestError for undefined template variable in prompt", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        promptContents: {
          "prompts/analyze.md": "Reference to {{undefined_variable}} in prompt.",
        },
      });
      cleanup = c;

      const engine = new AgentEngine(silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toThrow(NightShiftError);
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toMatchObject({ code: "MANIFEST" });
    });

    it("does not create any nightshift-* temp directories during dry-run", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;

      const tmpBase = os.tmpdir();

      // Count nightshift dirs before
      const before = (await fs.readdir(tmpBase)).filter((n) =>
        n.startsWith("nightshift-"),
      );

      const engine = new AgentEngine(silentLogger());
      await engine.dryRun(agentDir, agentsRoot);

      // Count nightshift dirs after
      const after = (await fs.readdir(tmpBase)).filter((n) =>
        n.startsWith("nightshift-"),
      );

      // No new nightshift dirs should have been created
      expect(after.length).toBe(before.length);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Context accumulation between steps
  // -------------------------------------------------------------------------

  describe("context accumulation between steps", () => {
    it("second step receives first step output substituted in its prompt", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "first",
            prompt: "prompts/first.md",
            outputSchema: {
              type: "object",
              properties: { step: { type: "string" } },
              required: ["step"],
            },
          },
          {
            name: "second",
            prompt: "prompts/second.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/first.md": "First step.",
          "prompts/second.md": "Previous step was: {{steps.first.output.step}}.",
        },
      });
      cleanup = c;

      mockSpawn
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"step":"done"}\n```')))
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)));

      const engine = new AgentEngine(silentLogger());
      await engine.run(agentDir, agentsRoot, "task-context");

      // Second spawn call args should contain the rendered template with "done"
      const secondCallArgs = mockSpawn.mock.calls[1];
      const argsStr = JSON.stringify(secondCallArgs[1]);
      expect(argsStr).toContain("done");
      expect(argsStr).not.toContain("{{steps.first.output.step}}");
    });

    it("finalOutput is the last step's parsed output", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "prepare",
            prompt: "prompts/prepare.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "execute",
            prompt: "prompts/execute.md",
            outputSchema: {
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"],
            },
          },
        ],
        promptContents: {
          "prompts/prepare.md": "Prepare step.",
          "prompts/execute.md": "Execute step.",
        },
      });
      cleanup = c;

      mockSpawn
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope(VALID_RESULT_OUTPUT)))
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"summary":"final result"}\n```')));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-final");

      expect(result.status).toBe("SUCCESS");
      expect(result.finalOutput).toEqual({ summary: "final result" });
    });

    it("stepOutputs map contains all completed step outputs", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "step-a",
            prompt: "prompts/step-a.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "step-b",
            prompt: "prompts/step-b.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/step-a.md": "Step A.",
          "prompts/step-b.md": "Step B.",
        },
      });
      cleanup = c;

      mockSpawn
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"result":"a-output"}\n```')))
        .mockReturnValueOnce(makeSpawnResult(cliEnvelope('```json\n{"result":"b-output"}\n```')));

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-outputs");

      expect(result.stepOutputs).toBeDefined();
      expect(result.stepOutputs!["step-a"]).toEqual({ result: "a-output" });
      expect(result.stepOutputs!["step-b"]).toEqual({ result: "b-output" });
    });
  });

  // -------------------------------------------------------------------------
  // 8. Semantic failure (output.status === "FAILED")
  // -------------------------------------------------------------------------

  describe("semantic failure detection", () => {
    it("step output with status: FAILED triggers semantic failure", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: {
                status: { type: "string" },
                reason: { type: "string" },
              },
              required: ["status", "reason"],
            },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"status":"FAILED","reason":"tests failed"}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-semantic-fail");

      expect(result.status).toBe("FATAL");
      expect(result.perStep[0].status).toBe("FAILED");
      expect(result.finalOutput).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Early exit (earlyExit.when)
  // -------------------------------------------------------------------------

  describe("early exit (earlyExit.when)", () => {
    it("triggers early exit when step output matches earlyExit.when conditions", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: { nothing_to_do: { type: "boolean" } },
              required: ["nothing_to_do"],
            },
            earlyExit: { when: { nothing_to_do: true } },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"nothing_to_do":true}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-early-exit");

      expect(result.status).toBe("SUCCESS");
      expect(result.earlyExitReason).toBeDefined();
    });

    it("does NOT trigger early exit when output does not match", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: { nothing_to_do: { type: "boolean" } },
              required: ["nothing_to_do"],
            },
            earlyExit: { when: { nothing_to_do: true } },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"nothing_to_do":false}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-no-early-exit");

      expect(result.status).toBe("SUCCESS");
      expect(result.earlyExitReason).toBeUndefined();
    });

    it("marks remaining steps SKIPPED with SUCCESS on early exit", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "step-one",
            prompt: "prompts/step-one.md",
            outputSchema: {
              type: "object",
              properties: { nothing_to_do: { type: "boolean" } },
              required: ["nothing_to_do"],
            },
            earlyExit: { when: { nothing_to_do: true } },
          },
          {
            name: "step-two",
            prompt: "prompts/step-two.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "step-three",
            prompt: "prompts/step-three.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/step-one.md": "Step one.",
          "prompts/step-two.md": "Step two.",
          "prompts/step-three.md": "Step three.",
        },
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"nothing_to_do":true}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-skip-remaining");

      expect(result.status).toBe("SUCCESS");
      expect(result.perStep).toHaveLength(3);
      expect(result.perStep[0]).toMatchObject({ name: "step-one", status: "SUCCESS" });
      expect(result.perStep[1]).toMatchObject({ name: "step-two", status: "SKIPPED", durationMs: 0 });
      expect(result.perStep[2]).toMatchObject({ name: "step-three", status: "SKIPPED", durationMs: 0 });
      expect(result.earlyExitReason).toBeDefined();
    });

    it("populates earlyExitReason from step.earlyExit.reason", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: { skip: { type: "boolean" } },
              required: ["skip"],
            },
            earlyExit: { when: { skip: true }, reason: "Nothing to do" },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"skip":true}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-reason");

      expect(result.earlyExitReason).toBe("Nothing to do");
    });

    it("earlyExitReason auto-generated when reason not provided", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: { nothing_to_do: { type: "boolean" } },
              required: ["nothing_to_do"],
            },
            earlyExit: { when: { nothing_to_do: true } },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"nothing_to_do":true}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-auto-reason");

      expect(result.earlyExitReason).toContain("nothing_to_do");
    });

    it("earlyExit takes precedence over retry trigger", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: {
                nothing_to_do: { type: "boolean" },
                passed: { type: "boolean" },
              },
              required: ["nothing_to_do", "passed"],
            },
            earlyExit: { when: { nothing_to_do: true } },
            retry: { maxAttempts: 3, retryFrom: "check" },
          },
        ],
      });
      cleanup = c;

      // Output matches earlyExit.when AND has passed: false (retry trigger)
      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"nothing_to_do":true,"passed":false}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-precedence");

      // earlyExit should win — pipeline exits with SUCCESS, not retry
      expect(result.status).toBe("SUCCESS");
      expect(result.earlyExitReason).toBeDefined();
      // Should only have been called once (no retry)
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it("deep equality matching for array values", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        steps: [
          {
            name: "check",
            prompt: "prompts/check.md",
            outputSchema: {
              type: "object",
              properties: { items: { type: "array", items: { type: "string" } } },
              required: ["items"],
            },
            earlyExit: { when: { items: [] } },
          },
        ],
      });
      cleanup = c;

      mockSpawn.mockReturnValue(
        makeSpawnResult(cliEnvelope('```json\n{"items":[]}\n```')),
      );

      const engine = new AgentEngine(silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-deep-eq");

      expect(result.status).toBe("SUCCESS");
      expect(result.earlyExitReason).toBeDefined();
    });
  });
});

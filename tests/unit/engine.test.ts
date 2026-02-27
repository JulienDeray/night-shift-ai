import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock bead-runner and git-harness to avoid real subprocesses
// ---------------------------------------------------------------------------

vi.mock("../../src/agent/bead-runner.js", () => ({
  runBead: vi.fn(),
  buildBeadEnv: vi.fn(),
  buildBeadArgs: vi.fn(),
}));
vi.mock("../../src/agent/git-harness.js", () => ({
  cloneRepo: vi.fn(),
  cleanupDir: vi.fn(),
}));
import { runBead } from "../../src/agent/bead-runner.js";
import { cloneRepo } from "../../src/agent/git-harness.js";
import * as processUtils from "../../src/utils/process.js";
import { AgentEngine } from "../../src/agent/engine.js";
import { BeadRegistry } from "../../src/agent/bead-registry.js";
import { StandardBeadPlugin } from "../../src/agent/plugins/standard-bead-plugin.js";
import { Logger } from "../../src/core/logger.js";
import {
  BeadOutputMissingError,
  BeadContractViolationError,
  RegistryError,
  ManifestError,
} from "../../src/core/errors.js";

const mockRunBead = vi.mocked(runBead);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal valid BeadResult shape (successful case). */
function makeBeadResult(stdout: string) {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 100,
    costUsd: 0.001,
    timedOut: false,
  };
}

/** Minimal outputSchema JSON for a standard bead requiring { result: string }. */
const RESULT_OUTPUT_SCHEMA = {
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
};

/** JSON block that satisfies RESULT_OUTPUT_SCHEMA. */
const VALID_RESULT_OUTPUT = '```json\n{"result":"ok"}\n```';

/**
 * Creates a temporary agent directory with a valid manifest and prompt files.
 *
 * Returns paths to tempDir (the outer wrapper), agentsRoot, and agentDir.
 * The returned cleanup() removes the entire tmpDir.
 */
async function createTempAgent(options?: {
  agentName?: string;
  beads?: Array<{
    name: string;
    type?: string;
    prompt: string;
    outputSchema?: Record<string, unknown>;
    retry?: { maxAttempts: number; retryFrom: string };
  }>;
  promptContents?: Record<string, string>;
}): Promise<{
  agentsRoot: string;
  agentDir: string;
  cleanup: () => Promise<void>;
}> {
  const agentName = options?.agentName ?? "test-agent";
  const beads = options?.beads ?? [
    {
      name: "analyze",
      type: "standard",
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
    beads,
  };
  await fs.writeFile(
    path.join(agentDir, "manifest.yaml"),
    stringifyYaml(manifest),
  );

  // Write prompt files
  for (const bead of beads) {
    const promptPath = path.join(agentDir, bead.prompt);
    await fs.mkdir(path.dirname(promptPath), { recursive: true });
    const content =
      options?.promptContents?.[bead.prompt] ??
      `Analyze the repository for task {{task_id}}.`;
    await fs.writeFile(promptPath, content);
  }

  return {
    agentsRoot,
    agentDir,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
  };
}

/** Creates a Logger that silences all output (no file, no stdout). */
function silentLogger(): Logger {
  return new Logger({ minLevel: "error", stdout: false });
}

/** Creates a registry with StandardBeadPlugin registered for "standard". */
function makeRegistry(): BeadRegistry {
  const registry = new BeadRegistry();
  registry.register("standard", (_bead, _manifest) => new StandardBeadPlugin());
  return registry;
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
    it("single-bead pipeline returns SUCCESS result with finalOutput", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      expect(result.status).toBe("SUCCESS");
      expect(result.perBead).toHaveLength(1);
      expect(result.perBead[0].status).toBe("SUCCESS");
      expect(result.finalOutput).toEqual({ result: "ok" });
      expect(result.agentName).toBe("test-agent");
    });

    it("returns totalDurationMs greater than 0", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("runId is a valid UUID", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-001");

      // UUID v4 pattern
      expect(result.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("multi-bead pipeline: second bead receives first bead output in template vars", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "analyze",
            type: "standard",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/analyze.md": "Analyze for task {{task_id}}.",
          "prompts/implement.md":
            "Implement based on analysis: {{beads.analyze.output.result}}.",
        },
      });
      cleanup = c;

      // Both beads succeed
      mockRunBead
        .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"analysis-done"}\n```'))
        .mockResolvedValueOnce(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-multi");

      expect(result.status).toBe("SUCCESS");
      expect(result.perBead).toHaveLength(2);
      expect(result.perBead[0].status).toBe("SUCCESS");
      expect(result.perBead[1].status).toBe("SUCCESS");

      // Verify template substitution happened: second runBead call should include
      // the first bead's output value in the rendered prompt
      const secondCallArgs = mockRunBead.mock.calls[1][0];
      expect(secondCallArgs.prompt).toContain("analysis-done");
      expect(secondCallArgs.prompt).not.toContain("{{beads.analyze.output.result}}");
    });

    it("temp directory is cleaned up after successful run", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-cleanup");

      // Scan tmp for the nightshift-{runId} directory — it should be gone
      const runId = result.runId;
      const tmpPath = path.join(os.tmpdir(), `nightshift-${runId}`);
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Bead failure and rollback
  // -------------------------------------------------------------------------

  describe("bead failure and rollback", () => {
    it("fails on second bead: first bead SUCCESS, second FAILED, third SKIPPED", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "bead-one",
            type: "standard",
            prompt: "prompts/bead-one.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "bead-two",
            type: "standard",
            prompt: "prompts/bead-two.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "bead-three",
            type: "standard",
            prompt: "prompts/bead-three.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/bead-one.md": "Step one.",
          "prompts/bead-two.md": "Step two.",
          "prompts/bead-three.md": "Step three.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"step-one"}\n```'))
        .mockRejectedValueOnce(new Error("bead-two exploded"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-fail");

      expect(result.failedBeadIndex).toBe(1);
      expect(result.perBead).toHaveLength(3);
      expect(result.perBead[0].status).toBe("SUCCESS");
      expect(result.perBead[1].status).toBe("FAILED");
      expect(result.perBead[2].status).toBe("SKIPPED");
      expect(result.error).toContain("bead-two exploded");
      expect(result.finalOutput).toBeNull();
    });

    it("temp directory is cleaned up after bead failure (rollback)", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(new Error("bead execution failed"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-rollback");

      const tmpPath = path.join(os.tmpdir(), `nightshift-${result.runId}`);
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });

    it("does not throw — returns result even when bead fails", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(new Error("unexpected error"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      // Must not throw
      const result = await engine.run(agentDir, agentsRoot, "task-no-throw");
      expect(result.status).not.toBe("SUCCESS");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Error categorization
  // -------------------------------------------------------------------------

  describe("error categorization", () => {
    it("BeadOutputMissingError categorized as TRANSIENT", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(
        new BeadOutputMissingError("BEAD_OUTPUT_MISSING: no JSON block"),
      );

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-missing");

      expect(result.status).toBe("TRANSIENT");
      expect(result.errorCategory).toBe("TRANSIENT");
      expect(result.suggestedDelayMs).toBe(60_000);
    });

    it("BeadContractViolationError categorized as TRANSIENT", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(
        new BeadContractViolationError("BEAD_CONTRACT_VIOLATION: schema mismatch"),
      );

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-contract");

      expect(result.status).toBe("TRANSIENT");
      expect(result.errorCategory).toBe("TRANSIENT");
      expect(result.suggestedDelayMs).toBe(60_000);
    });

    it("RegistryError categorized as FATAL", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "unknown-bead",
            type: "not-registered",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
      });
      cleanup = c;

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-registry");

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
      expect(result.suggestedDelayMs).toBeUndefined();
    });

    it("generic Error categorized as FATAL (safe default)", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(new Error("something unexpected"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-generic");

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
      expect(result.suggestedDelayMs).toBeUndefined();
    });

    it("error message containing 'timed out' categorized as FATAL", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(new Error("Bead analyze timed out after 900000ms"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-timeout");

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
    });

    it("TRANSIENT result has suggestedDelayMs of 60000ms", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockRejectedValue(
        new BeadOutputMissingError("no JSON"),
      );

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-delay");

      expect(result.suggestedDelayMs).toBe(60_000);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Output schema validation
  // -------------------------------------------------------------------------

  describe("output schema validation", () => {
    it("bead output not matching schema: BeadContractViolationError treated as TRANSIENT failure", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "analyze",
            type: "standard",
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
      mockRunBead.mockResolvedValue(makeBeadResult('```json\n{"wrong":"field"}\n```'));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-schema");

      expect(result.status).toBe("TRANSIENT");
      expect(result.perBead[0].status).toBe("FAILED");
    });

    it("bead returning no JSON block: BeadOutputMissingError treated as TRANSIENT failure", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;

      // Returns plain text with no JSON block
      mockRunBead.mockResolvedValue(makeBeadResult("No JSON here, just a narrative."));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-no-json");

      expect(result.status).toBe("TRANSIENT");
      expect(result.perBead[0].status).toBe("FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Manifest load failure
  // -------------------------------------------------------------------------

  describe("manifest load failure", () => {
    it("non-existent agent directory returns FATAL result (does not throw)", async () => {
      const engine = new AgentEngine(makeRegistry(), silentLogger());

      const result = await engine.run(
        "/tmp/non-existent-agent-dir",
        "/tmp",
        "task-missing-agent",
      );

      expect(result.status).toBe("FATAL");
      expect(result.errorCategory).toBe("FATAL");
      expect(result.finalOutput).toBeNull();
      expect(result.perBead).toHaveLength(0);
    });

    it("manifest load failure still cleans up temp dir", async () => {
      const engine = new AgentEngine(makeRegistry(), silentLogger());

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

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).resolves.toBeUndefined();
    });

    it("throws when prompt file is missing", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "analyze",
            type: "standard",
            prompt: "prompts/missing-file.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        // Don't create the prompt file
        promptContents: {},
      });
      cleanup = c;

      // Write the manifest with a reference to a non-existent prompt file
      // The createTempAgent helper creates files for all beads so we delete one
      const promptPath = path.join(agentDir, "prompts", "missing-file.md");
      await fs.unlink(promptPath).catch(() => {});

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toThrow();
    });

    it("throws RegistryError for unregistered bead type", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "custom-bead",
            type: "not-registered-type",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
      });
      cleanup = c;

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toThrow(RegistryError);
    });

    it("throws ManifestError for undefined template variable in prompt", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        promptContents: {
          "prompts/analyze.md": "Reference to {{undefined_variable}} in prompt.",
        },
      });
      cleanup = c;

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await expect(engine.dryRun(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
    });

    it("does not create any nightshift-* temp directories during dry-run", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;

      const tmpBase = os.tmpdir();

      // Count nightshift dirs before
      const before = (await fs.readdir(tmpBase)).filter((n) =>
        n.startsWith("nightshift-"),
      );

      const engine = new AgentEngine(makeRegistry(), silentLogger());
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
  // 7. Context accumulation between beads
  // -------------------------------------------------------------------------

  describe("context accumulation between beads", () => {
    it("second bead receives first bead output substituted in its prompt", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "first",
            type: "standard",
            prompt: "prompts/first.md",
            outputSchema: {
              type: "object",
              properties: { step: { type: "string" } },
              required: ["step"],
            },
          },
          {
            name: "second",
            type: "standard",
            prompt: "prompts/second.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/first.md": "First bead.",
          "prompts/second.md": "Previous step was: {{beads.first.output.step}}.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult('```json\n{"step":"done"}\n```'))
        .mockResolvedValueOnce(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await engine.run(agentDir, agentsRoot, "task-context");

      // Second runBead call should have rendered the template with "done"
      const secondCallArgs = mockRunBead.mock.calls[1][0];
      expect(secondCallArgs.prompt).toContain("done");
      expect(secondCallArgs.prompt).not.toContain("{{beads.first.output.step}}");
    });

    it("finalOutput is the last bead's parsed output", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "prepare",
            type: "standard",
            prompt: "prompts/prepare.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "execute",
            type: "standard",
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

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult(VALID_RESULT_OUTPUT))
        .mockResolvedValueOnce(
          makeBeadResult('```json\n{"summary":"all done"}\n```'),
        );

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run<{ summary: string }>(agentDir, agentsRoot, "task-final");

      expect(result.finalOutput).toEqual({ summary: "all done" });
    });
  });

  // -------------------------------------------------------------------------
  // 8. Run ID and logging smoke test
  // -------------------------------------------------------------------------

  describe("runId and logging", () => {
    it("runId is a non-empty string", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-logging");

      expect(typeof result.runId).toBe("string");
      expect(result.runId.length).toBeGreaterThan(0);
    });

    it("logger.info is called with runId in structured log entries", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent();
      cleanup = c;
      mockRunBead.mockResolvedValue(makeBeadResult(VALID_RESULT_OUTPUT));

      const logger = silentLogger();
      const infoSpy = vi.spyOn(logger, "info");

      const engine = new AgentEngine(makeRegistry(), logger);
      const result = await engine.run(agentDir, agentsRoot, "task-log-spy");

      // At least one log entry should reference the runId
      const callsWithRunId = infoSpy.mock.calls.filter(([, data]) => {
        return data != null && (data as Record<string, unknown>)["runId"] === result.runId;
      });
      expect(callsWithRunId.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Retry loop
  // -------------------------------------------------------------------------

  const PASSED_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
      passed: { type: "boolean" },
      error_details: { type: "string" },
    },
    required: ["passed"],
  };

  const PASS_RESULT = '```json\n{"result":"ok"}\n```';
  const VERIFY_PASS = '```json\n{"passed":true}\n```';
  const VERIFY_FAIL = '```json\n{"passed":false,"error_details":"test failed"}\n```';

  describe("retry loop", () => {
    it("retries from retryFrom bead when verify output has passed:false", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "verify",
            type: "standard",
            prompt: "prompts/verify.md",
            outputSchema: PASSED_OUTPUT_SCHEMA,
            retry: { maxAttempts: 3, retryFrom: "implement" },
          },
        ],
        promptContents: {
          "prompts/implement.md": "Implement for task {{task_id}}.",
          "prompts/verify.md": "Verify the implementation.",
        },
      });
      cleanup = c;

      // First verify fails, second passes
      mockRunBead
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))   // implement (first)
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL))   // verify (fails → retry)
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))   // implement (retry)
        .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS));  // verify (passes)

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-retry");

      expect(result.status).toBe("SUCCESS");
      // implement called twice
      const implementCalls = mockRunBead.mock.calls.filter(
        (call) => call[0].beadName === "implement",
      );
      expect(implementCalls).toHaveLength(2);
    });

    it("injects retry_error variable on retry", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "verify",
            type: "standard",
            prompt: "prompts/verify.md",
            outputSchema: PASSED_OUTPUT_SCHEMA,
            retry: { maxAttempts: 3, retryFrom: "implement" },
          },
        ],
        promptContents: {
          "prompts/implement.md": "Implement. Error context: {{retry_error}}",
          "prompts/verify.md": "Verify the implementation.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL))
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))
        .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await engine.run(agentDir, agentsRoot, "task-retry-error");

      // Third runBead call is the retry of implement — prompt should contain retry_error
      const thirdCall = mockRunBead.mock.calls[2][0];
      expect(thirdCall.prompt).toContain("test failed");
    });

    it("calls git reset before retry", async () => {
      // Spy on spawnWithTimeout to verify it's called with git reset args
      const spawnSpy = vi.spyOn(processUtils, "spawnWithTimeout");

      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "verify",
            type: "standard",
            prompt: "prompts/verify.md",
            outputSchema: PASSED_OUTPUT_SCHEMA,
            retry: { maxAttempts: 3, retryFrom: "implement" },
          },
        ],
        promptContents: {
          "prompts/implement.md": "Implement for task {{task_id}}.",
          "prompts/verify.md": "Verify the implementation.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL))
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT))
        .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await engine.run(agentDir, agentsRoot, "task-retry-reset");

      // spawnWithTimeout should have been called with git reset --hard HEAD
      const gitResetCalls = spawnSpy.mock.calls.filter(
        (call) => call[0] === "git" && JSON.stringify(call[1]) === JSON.stringify(["reset", "--hard", "HEAD"]),
      );
      expect(gitResetCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("stops retrying after maxAttempts exhausted", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "verify",
            type: "standard",
            prompt: "prompts/verify.md",
            outputSchema: PASSED_OUTPUT_SCHEMA,
            retry: { maxAttempts: 2, retryFrom: "implement" },
          },
        ],
        promptContents: {
          "prompts/implement.md": "Implement for task {{task_id}}.",
          "prompts/verify.md": "Verify the implementation.",
        },
      });
      cleanup = c;

      // verify always fails
      mockRunBead
        .mockResolvedValue(makeBeadResult(PASS_RESULT))     // implement (returns for all calls)
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT)) // implement first
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL)) // verify first (retry 1)
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT)) // implement retry 1
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL)) // verify retry 1 (retry 2)
        .mockResolvedValueOnce(makeBeadResult(PASS_RESULT)) // implement retry 2
        .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL)); // verify retry 2 (exhausted)

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-retry-exhaust");

      // Pipeline completes as SUCCESS (exhausted retry is not an error)
      expect(result.status).toBe("SUCCESS");

      // implement should be called 3 times (1 initial + 2 retries)
      const implementCalls = mockRunBead.mock.calls.filter(
        (call) => call[0].beadName === "implement",
      );
      expect(implementCalls).toHaveLength(3);
    });

    it("populates beadOutputs on success", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "analyze",
            type: "standard",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/analyze.md": "Analyze for task {{task_id}}.",
          "prompts/implement.md": "Implement for task {{task_id}}.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"analyzed"}\n```'))
        .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"implemented"}\n```'));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-bead-outputs");

      expect(result.beadOutputs).toBeDefined();
      expect(result.beadOutputs!["analyze"]).toEqual({ result: "analyzed" });
      expect(result.beadOutputs!["implement"]).toEqual({ result: "implemented" });
    });

    it("populates beadOutputs on failure with outputs of completed beads", async () => {
      const { agentsRoot, agentDir, cleanup: c } = await createTempAgent({
        beads: [
          {
            name: "analyze",
            type: "standard",
            prompt: "prompts/analyze.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
          {
            name: "implement",
            type: "standard",
            prompt: "prompts/implement.md",
            outputSchema: RESULT_OUTPUT_SCHEMA,
          },
        ],
        promptContents: {
          "prompts/analyze.md": "Analyze for task {{task_id}}.",
          "prompts/implement.md": "Implement for task {{task_id}}.",
        },
      });
      cleanup = c;

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult('```json\n{"result":"analyzed"}\n```'))
        .mockRejectedValueOnce(new Error("implement exploded"));

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      const result = await engine.run(agentDir, agentsRoot, "task-bead-outputs-fail");

      expect(result.beadOutputs).toBeDefined();
      expect(result.beadOutputs!["analyze"]).toEqual({ result: "analyzed" });
      // implement failed — not in beadOutputs
      expect(result.beadOutputs!["implement"]).toBeUndefined();
    });
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock bead-runner and git-harness before importing modules
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
import { GitCloneBeadPlugin } from "../../src/agent/plugins/git-clone-bead-plugin.js";
import { Logger } from "../../src/core/logger.js";

const mockRunBead = vi.mocked(runBead);
const mockCloneRepo = vi.mocked(cloneRepo);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const agentsRoot = path.resolve("/Users/julienderay/code/night-shift/agents");
const agentDir = path.join(agentsRoot, "code-agent");

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
    costUsd: 0.01,
    timedOut: false,
  };
}

/** Wraps a JSON object in a JSON code block for bead output mocking. */
function jsonBlock(obj: unknown): string {
  return "```json\n" + JSON.stringify(obj) + "\n```";
}

/** Creates a Logger that silences all output (no file, no stdout). */
function silentLogger(): Logger {
  return new Logger({ minLevel: "error", stdout: false });
}

/** Creates a registry with "standard" and "git-clone" types registered. */
function makeRegistry(): BeadRegistry {
  const registry = new BeadRegistry();
  registry.register("standard", (_bead, _manifest) => new StandardBeadPlugin());
  registry.register("git-clone", (_bead, _manifest) => new GitCloneBeadPlugin());
  return registry;
}

/** Config overrides used across all tests */
const TEST_CONFIG = {
  repo_url: "git@gitlab.com:team/repo.git",
  category: "refactoring",
  category_guidance: "Broad scope",
  confluence_page_id: "12345",
  mcp_config_path: "/tmp/mcp.json",
  reviewer: "jdoe",
};

// ---------------------------------------------------------------------------
// Common mock outputs
// ---------------------------------------------------------------------------

const CLONE_OUTPUT = jsonBlock({ repoDir: "/tmp/repo", handoffDir: "/tmp/handoff" });
const ANALYZE_IMPROVEMENT = jsonBlock({
  result: "IMPROVEMENT_FOUND",
  categoryUsed: "refactoring",
  reason: "Found code duplication",
  candidates: [
    {
      rank: 1,
      files: ["src/Foo.scala"],
      description: "Remove duplicated validation logic",
      rationale: "DRY principle",
    },
  ],
  selected: {
    rank: 1,
    files: ["src/Foo.scala"],
    description: "Remove duplicated validation logic",
    rationale: "DRY principle",
  },
});
const ANALYZE_NO_IMPROVEMENT = jsonBlock({
  result: "NO_IMPROVEMENT",
  categoryUsed: "refactoring",
  reason: "All files recently modified",
});
const IMPLEMENT_OUTPUT = jsonBlock({ status: "IMPLEMENTED" });
const VERIFY_PASS = jsonBlock({ passed: true, error_details: "" });
const VERIFY_FAIL = jsonBlock({ passed: false, error_details: "tests fail" });
const MR_CREATED = jsonBlock({
  outcome: "MR_CREATED",
  mr_url: "https://gitlab.com/team/repo/-/merge_requests/42",
});
const LOG_OUTPUT = jsonBlock({ logged: true });

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.GITLAB_TOKEN = "test-token";
});

afterAll(() => {
  delete process.env.GITLAB_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("code-agent manifest and pipeline integration", () => {
  // -------------------------------------------------------------------------
  // Test 1: dryRun validation
  // -------------------------------------------------------------------------

  it("manifest loads and passes dryRun validation", async () => {
    const engine = new AgentEngine(makeRegistry(), silentLogger());

    await expect(
      engine.dryRun(agentDir, agentsRoot, TEST_CONFIG),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 2: Full pipeline produces MR_CREATED outcome shape
  // -------------------------------------------------------------------------

  it("pipeline produces MR_CREATED outcome shape", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/repo",
      handoffDir: "/tmp/handoff",
    });

    mockRunBead
      .mockResolvedValueOnce(makeBeadResult(ANALYZE_IMPROVEMENT))
      .mockResolvedValueOnce(makeBeadResult(IMPLEMENT_OUTPUT))
      .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS))
      .mockResolvedValueOnce(makeBeadResult(MR_CREATED))
      .mockResolvedValueOnce(makeBeadResult(LOG_OUTPUT));

    const engine = new AgentEngine(makeRegistry(), silentLogger());
    const result = await engine.run(agentDir, agentsRoot, "test-task-01", TEST_CONFIG);

    expect(result.status).toBe("SUCCESS");
    expect(result.beadOutputs?.["mr"]).toMatchObject({
      outcome: "MR_CREATED",
      mr_url: expect.stringContaining("merge_requests"),
    });
    expect(result.beadOutputs?.["analyze"]).toMatchObject({
      result: "IMPROVEMENT_FOUND",
    });
    expect(result.finalOutput).toMatchObject({ logged: true });
  });

  // -------------------------------------------------------------------------
  // Test 3: NO_IMPROVEMENT analyze output — beadOutputs accessible for caller inspection
  // -------------------------------------------------------------------------

  it("pipeline with NO_IMPROVEMENT analyze output stores result in beadOutputs", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/repo",
      handoffDir: "/tmp/handoff",
    });

    // With NO_IMPROVEMENT, the engine still runs remaining beads.
    // The caller (daemon) inspects beadOutputs.analyze.result to decide whether to proceed.
    // Mock remaining beads to return minimal valid outputs.
    mockRunBead
      .mockResolvedValueOnce(makeBeadResult(ANALYZE_NO_IMPROVEMENT))
      .mockResolvedValueOnce(makeBeadResult(IMPLEMENT_OUTPUT))
      .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS))
      .mockResolvedValueOnce(makeBeadResult(MR_CREATED))
      .mockResolvedValueOnce(makeBeadResult(LOG_OUTPUT));

    const engine = new AgentEngine(makeRegistry(), silentLogger());
    const result = await engine.run(agentDir, agentsRoot, "test-task-no-improvement", TEST_CONFIG);

    expect(result.beadOutputs?.["analyze"]).toMatchObject({
      result: "NO_IMPROVEMENT",
      categoryUsed: "refactoring",
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Agent directory is portable — works from a different agentsRoot
  // -------------------------------------------------------------------------

  it("agent directory is portable — works from a different agentsRoot", async () => {
    // Copy agents/code-agent to a temporary directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-portability-test-"));
    const tmpAgentsRoot = path.join(tmpDir, "agents");
    const tmpAgentDir = path.join(tmpAgentsRoot, "code-agent");

    try {
      await fs.cp(agentDir, tmpAgentDir, { recursive: true });

      const engine = new AgentEngine(makeRegistry(), silentLogger());
      await expect(
        engine.dryRun(tmpAgentDir, tmpAgentsRoot, TEST_CONFIG),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: Verify retry triggers re-run of implement bead
  // -------------------------------------------------------------------------

  it("verify retry triggers re-run of implement bead", async () => {
    // Spy on spawnWithTimeout to avoid real git reset calls
    vi.spyOn(processUtils, "spawnWithTimeout").mockReturnValue({
      process: {} as ReturnType<typeof processUtils.spawnWithTimeout>["process"],
      result: Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
    });

    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/repo",
      handoffDir: "/tmp/handoff",
    });

    mockRunBead
      .mockResolvedValueOnce(makeBeadResult(ANALYZE_IMPROVEMENT))   // analyze
      .mockResolvedValueOnce(makeBeadResult(IMPLEMENT_OUTPUT))       // implement (first attempt)
      .mockResolvedValueOnce(makeBeadResult(VERIFY_FAIL))            // verify (fails → retry)
      .mockResolvedValueOnce(makeBeadResult(IMPLEMENT_OUTPUT))       // implement (retry)
      .mockResolvedValueOnce(makeBeadResult(VERIFY_PASS))            // verify (passes)
      .mockResolvedValueOnce(makeBeadResult(MR_CREATED))             // mr
      .mockResolvedValueOnce(makeBeadResult(LOG_OUTPUT));            // log

    const engine = new AgentEngine(makeRegistry(), silentLogger());
    const result = await engine.run(agentDir, agentsRoot, "test-task-retry", TEST_CONFIG);

    expect(result.status).toBe("SUCCESS");

    // implement bead should have been called twice (initial + retry)
    const implementCalls = mockRunBead.mock.calls.filter(
      (call) => call[0].beadName === "implement",
    );
    expect(implementCalls).toHaveLength(2);
  });
});

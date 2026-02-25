import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before importing the module under test
vi.mock("../../src/agent/git-harness.js", () => ({
  cloneRepo: vi.fn(),
  cleanupDir: vi.fn(),
}));

vi.mock("../../src/agent/code-agent-runner.js", () => ({
  runCodeAgentPipeline: vi.fn(),
}));

vi.mock("../../src/agent/run-logger.js", () => ({
  appendRunLog: vi.fn(),
}));

vi.mock("../../src/agent/bead-runner.js", () => ({
  runBead: vi.fn(),
}));

vi.mock("../../src/agent/prompt-loader.js", () => ({
  loadBeadPrompt: vi.fn(),
}));

import { runCodeAgent, deriveSummary } from "../../src/agent/code-agent.js";
import { cloneRepo, cleanupDir } from "../../src/agent/git-harness.js";
import { runCodeAgentPipeline } from "../../src/agent/code-agent-runner.js";
import { appendRunLog } from "../../src/agent/run-logger.js";
import { runBead } from "../../src/agent/bead-runner.js";
import { loadBeadPrompt } from "../../src/agent/prompt-loader.js";
import type { CodeAgentConfig } from "../../src/core/types.js";
import type { CodeAgentRunResult } from "../../src/agent/types.js";
import type { Logger } from "../../src/core/logger.js";

const mockCloneRepo = vi.mocked(cloneRepo);
const mockCleanupDir = vi.mocked(cleanupDir);
const mockRunCodeAgentPipeline = vi.mocked(runCodeAgentPipeline);
const mockAppendRunLog = vi.mocked(appendRunLog);
const mockRunBead = vi.mocked(runBead);
const mockLoadBeadPrompt = vi.mocked(loadBeadPrompt);

function makeConfig(overrides: Partial<CodeAgentConfig> = {}): CodeAgentConfig {
  return {
    repoUrl: "git@gitlab.com:team/repo.git",
    confluencePageId: "page-42",
    categorySchedule: { monday: ["tests"] },
    prompts: {
      analyze: "./prompts/analyze.md",
      implement: "./prompts/implement.md",
      verify: "./prompts/verify.md",
      mr: "./prompts/mr.md",
      log: "./prompts/log.md",
    },
    logMcpConfig: "/etc/mcp-atlassian.json",
    reviewer: "jsmith",
    allowedCommands: ["git", "glab"],
    variables: {},
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePipelineResult(
  overrides: Partial<CodeAgentRunResult> = {},
): CodeAgentRunResult {
  return {
    outcome: "MR_CREATED",
    mrUrl: "https://gitlab.com/team/repo/-/merge_requests/42",
    categoryUsed: "tests",
    isFallback: false,
    totalCostUsd: 0.12,
    totalDurationMs: 30000,
    ...overrides,
  };
}

function makeBeadResult() {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      session_id: "sess-log",
      duration_ms: 5000,
      total_cost_usd: 0.01,
      result: "Confluence updated",
      is_error: false,
      num_turns: 2,
    }),
    stderr: "",
    durationMs: 5000,
    costUsd: 0.01,
    timedOut: false,
  };
}

const CLONE_RESULT = {
  repoDir: "/tmp/night-shift-repo-abc-xyz",
  handoffDir: "/tmp/night-shift-handoff-abc-xyz",
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default: cloneRepo succeeds
  mockCloneRepo.mockResolvedValue(CLONE_RESULT);

  // Default: cleanupDir succeeds (unconditional)
  mockCleanupDir.mockResolvedValue(undefined);

  // Default: pipeline returns MR_CREATED
  mockRunCodeAgentPipeline.mockResolvedValue(makePipelineResult());

  // Default: appendRunLog succeeds
  mockAppendRunLog.mockResolvedValue(undefined);

  // Default: loadBeadPrompt returns a prompt
  mockLoadBeadPrompt.mockResolvedValue("SECURITY CONTEXT\n---\nLog prompt");

  // Default: runBead for log succeeds
  mockRunBead.mockResolvedValue(makeBeadResult());
});

describe("runCodeAgent", () => {
  describe("happy path — full lifecycle", () => {
    it("calls cloneRepo, runCodeAgentPipeline, appendRunLog, runBead (log), and cleanupDir in order", async () => {
      const callOrder: string[] = [];

      mockCloneRepo.mockImplementation(async () => {
        callOrder.push("cloneRepo");
        return CLONE_RESULT;
      });
      mockRunCodeAgentPipeline.mockImplementation(async () => {
        callOrder.push("runCodeAgentPipeline");
        return makePipelineResult();
      });
      mockAppendRunLog.mockImplementation(async () => {
        callOrder.push("appendRunLog");
      });
      mockLoadBeadPrompt.mockImplementation(async () => {
        callOrder.push("loadBeadPrompt");
        return "rendered log prompt";
      });
      mockRunBead.mockImplementation(async () => {
        callOrder.push("runBead");
        return makeBeadResult();
      });
      mockCleanupDir.mockImplementation(async () => {
        callOrder.push("cleanupDir");
      });

      const config = makeConfig();
      const logger = makeLogger();

      await runCodeAgent(config, "/config", { timeoutMs: 60000, logger });

      // cloneRepo must be first
      expect(callOrder[0]).toBe("cloneRepo");
      // pipeline after clone
      expect(callOrder[1]).toBe("runCodeAgentPipeline");
      // JSONL log after pipeline
      expect(callOrder[2]).toBe("appendRunLog");
      // log bead after JSONL
      expect(callOrder[3]).toBe("loadBeadPrompt");
      expect(callOrder[4]).toBe("runBead");
      // cleanup happens last (finally block)
      expect(callOrder.slice(-2)).toEqual(["cleanupDir", "cleanupDir"]);
    });

    it("returns the pipeline result", async () => {
      const pipelineResult = makePipelineResult({
        outcome: "MR_CREATED",
        mrUrl: "https://gitlab.com/-/mr/99",
        totalCostUsd: 0.55,
      });
      mockRunCodeAgentPipeline.mockResolvedValue(pipelineResult);

      const result = await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      expect(result).toStrictEqual(pipelineResult);
    });
  });

  describe("cleanup on pipeline throw", () => {
    it("calls cleanupDir for both repoDir and handoffDir even when pipeline throws", async () => {
      mockRunCodeAgentPipeline.mockRejectedValue(new Error("Pipeline crashed"));

      await expect(
        runCodeAgent(makeConfig(), "/config", {
          timeoutMs: 60000,
          logger: makeLogger(),
        }),
      ).rejects.toThrow("Pipeline crashed");

      // Cleanup must still have been called for both dirs
      expect(mockCleanupDir).toHaveBeenCalledTimes(2);
      expect(mockCleanupDir).toHaveBeenCalledWith(CLONE_RESULT.repoDir);
      expect(mockCleanupDir).toHaveBeenCalledWith(CLONE_RESULT.handoffDir);
    });

    it("propagates the pipeline error after cleanup", async () => {
      mockRunCodeAgentPipeline.mockRejectedValue(new Error("Timeout during implement"));

      await expect(
        runCodeAgent(makeConfig(), "/config", {
          timeoutMs: 60000,
          logger: makeLogger(),
        }),
      ).rejects.toThrow("Timeout during implement");
    });
  });

  describe("JSONL log write failure", () => {
    it("logs error but still returns pipeline result when appendRunLog throws", async () => {
      mockAppendRunLog.mockRejectedValue(new Error("Disk full"));
      const logger = makeLogger();

      const result = await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger,
      });

      // Pipeline result still returned
      expect(result.outcome).toBe("MR_CREATED");

      // Error logged
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to write JSONL run log",
        expect.objectContaining({ error: "Disk full" }),
      );
    });

    it("still invokes log bead even when appendRunLog throws", async () => {
      mockAppendRunLog.mockRejectedValue(new Error("Disk full"));

      await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      // Log bead must still run
      expect(mockRunBead).toHaveBeenCalledWith(
        expect.objectContaining({ beadName: "log" }),
      );
    });
  });

  describe("log bead failure", () => {
    it("logs error but still returns pipeline result when runBead (log) throws", async () => {
      mockRunBead.mockRejectedValue(new Error("MCP connection refused"));
      const logger = makeLogger();

      const result = await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger,
      });

      // Pipeline result still returned
      expect(result.outcome).toBe("MR_CREATED");

      // Error logged
      expect(logger.error).toHaveBeenCalledWith(
        "Log bead failed — Confluence not updated",
        expect.objectContaining({ error: "MCP connection refused" }),
      );
    });

    it("still runs cleanup when log bead throws", async () => {
      mockRunBead.mockRejectedValue(new Error("Log bead crashed"));

      await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      expect(mockCleanupDir).toHaveBeenCalledTimes(2);
    });
  });

  describe("no logMcpConfig", () => {
    it("skips log bead and logs warning when logMcpConfig is undefined", async () => {
      const config = makeConfig({ logMcpConfig: undefined });
      const logger = makeLogger();

      await runCodeAgent(config, "/config", { timeoutMs: 60000, logger });

      // Log bead must NOT be invoked
      expect(mockRunBead).not.toHaveBeenCalled();

      // Warning must be logged
      expect(logger.warn).toHaveBeenCalledWith(
        "log_mcp_config not set — skipping Confluence update",
      );
    });

    it("still writes JSONL log when logMcpConfig is undefined", async () => {
      const config = makeConfig({ logMcpConfig: undefined });

      await runCodeAgent(config, "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      expect(mockAppendRunLog).toHaveBeenCalledTimes(1);
    });
  });

  describe("NO_IMPROVEMENT outcome", () => {
    it("writes JSONL entry with mr_url=null and summary from reason", async () => {
      mockRunCodeAgentPipeline.mockResolvedValue(
        makePipelineResult({
          outcome: "NO_IMPROVEMENT",
          mrUrl: undefined,
          categoryUsed: "tests",
          reason: "All paths covered",
          totalCostUsd: 0.05,
          totalDurationMs: 15000,
        }),
      );

      await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      expect(mockAppendRunLog).toHaveBeenCalledWith(
        expect.objectContaining({
          mr_url: null,
          category: "tests",
          summary: "All paths covered",
          duration_seconds: 15,
          cost_usd: 0.05,
        }),
        undefined,
      );
    });
  });

  describe("MR_CREATED outcome", () => {
    it("writes JSONL entry with mr_url set and log bead receives correct vars including confluence_page_id", async () => {
      const mrUrl = "https://gitlab.com/team/repo/-/merge_requests/77";
      mockRunCodeAgentPipeline.mockResolvedValue(
        makePipelineResult({ outcome: "MR_CREATED", mrUrl, categoryUsed: "tests" }),
      );

      const config = makeConfig({
        confluencePageId: "page-999",
        logMcpConfig: "/etc/mcp.json",
      });

      await runCodeAgent(config, "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      // JSONL log has mr_url set
      expect(mockAppendRunLog).toHaveBeenCalledWith(
        expect.objectContaining({ mr_url: mrUrl }),
        undefined,
      );

      // Log bead prompt was loaded with confluence_page_id
      expect(mockLoadBeadPrompt).toHaveBeenCalledWith(
        "./prompts/log.md",
        expect.objectContaining({ confluence_page_id: "page-999" }),
        "/config",
      );
    });
  });

  describe("log bead receives MCP config", () => {
    it("calls runBead with mcpConfigPath and Atlassian-only allowedTools when logMcpConfig is set", async () => {
      const config = makeConfig({ logMcpConfig: "/etc/mcp-atlassian.json" });

      await runCodeAgent(config, "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      expect(mockRunBead).toHaveBeenCalledWith(
        expect.objectContaining({
          beadName: "log",
          mcpConfigPath: "/etc/mcp-atlassian.json",
          allowedTools: [
            "mcp__atlassian__getAccessibleAtlassianResources",
            "mcp__atlassian__getConfluencePage",
            "mcp__atlassian__updateConfluencePage",
          ],
        }),
      );
    });
  });

  describe("log bead does NOT receive gitlabToken", () => {
    it("log bead runBead call has gitlabToken undefined even when gitlabToken is passed", async () => {
      const config = makeConfig({ logMcpConfig: "/etc/mcp.json" });

      await runCodeAgent(config, "/config", {
        gitlabToken: "glpat-secret-12345",
        timeoutMs: 60000,
        logger: makeLogger(),
      });

      const logBeadCall = mockRunBead.mock.calls.find(
        (c) => c[0].beadName === "log",
      );
      expect(logBeadCall).toBeDefined();
      expect(logBeadCall![0].gitlabToken).toBeUndefined();
    });
  });

  describe("base option for JSONL log path", () => {
    it("passes base option through to appendRunLog", async () => {
      await runCodeAgent(makeConfig(), "/config", {
        timeoutMs: 60000,
        logger: makeLogger(),
        base: "/custom/base",
      });

      expect(mockAppendRunLog).toHaveBeenCalledWith(
        expect.any(Object),
        "/custom/base",
      );
    });
  });
});

describe("deriveSummary", () => {
  it("MR_CREATED uses mrUrl when available", () => {
    const result = makePipelineResult({
      outcome: "MR_CREATED",
      mrUrl: "https://gitlab.com/-/mr/5",
    });
    expect(deriveSummary(result)).toBe("https://gitlab.com/-/mr/5");
  });

  it("MR_CREATED falls back to 'MR created' when mrUrl is undefined", () => {
    const result = makePipelineResult({ outcome: "MR_CREATED", mrUrl: undefined });
    expect(deriveSummary(result)).toBe("MR created");
  });

  it("NO_IMPROVEMENT uses reason when available", () => {
    const result = makePipelineResult({
      outcome: "NO_IMPROVEMENT",
      reason: "All paths covered",
    });
    expect(deriveSummary(result)).toBe("All paths covered");
  });

  it("NO_IMPROVEMENT falls back to 'No improvement found' when reason is undefined", () => {
    const result = makePipelineResult({ outcome: "NO_IMPROVEMENT", reason: undefined });
    expect(deriveSummary(result)).toBe("No improvement found");
  });

  it("ABANDONED uses reason when available", () => {
    const result = makePipelineResult({
      outcome: "ABANDONED",
      reason: "Max retries exceeded",
    });
    expect(deriveSummary(result)).toBe("Max retries exceeded");
  });

  it("ABANDONED falls back to 'Abandoned after retries' when reason is undefined", () => {
    const result = makePipelineResult({ outcome: "ABANDONED", reason: undefined });
    expect(deriveSummary(result)).toBe("Abandoned after retries");
  });
});

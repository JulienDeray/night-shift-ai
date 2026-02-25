import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";

// Mock dependencies before importing the module under test
vi.mock("../../src/agent/bead-runner.js", () => ({
  runBead: vi.fn(),
}));

vi.mock("../../src/agent/prompt-loader.js", () => ({
  loadBeadPrompt: vi.fn(),
}));

vi.mock("../../src/daemon/scheduler.js", () => ({
  resolveCategory: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock("../../src/utils/process.js", () => ({
  spawnWithTimeout: vi.fn(),
}));

import { runCodeAgentPipeline, type PipelineContext } from "../../src/agent/code-agent-runner.js";
import { runBead } from "../../src/agent/bead-runner.js";
import { loadBeadPrompt } from "../../src/agent/prompt-loader.js";
import { resolveCategory } from "../../src/daemon/scheduler.js";
import { spawnWithTimeout } from "../../src/utils/process.js";
import fs from "node:fs/promises";
import type { CodeAgentConfig } from "../../src/core/types.js";
import type { AnalysisResult } from "../../src/agent/types.js";

const mockRunBead = vi.mocked(runBead);
const mockLoadBeadPrompt = vi.mocked(loadBeadPrompt);
const mockResolveCategory = vi.mocked(resolveCategory);
const mockSpawnWithTimeout = vi.mocked(spawnWithTimeout);
const mockFsWriteFile = vi.mocked(fs.writeFile);
const mockFsReadFile = vi.mocked(fs.readFile);

function makeConfig(overrides: Partial<CodeAgentConfig> = {}): CodeAgentConfig {
  return {
    repoUrl: "git@gitlab.com:team/repo.git",
    confluencePageId: "123456",
    categorySchedule: {
      monday: ["tests"],
    },
    prompts: {
      analyze: "./prompts/analyze.md",
      implement: "./prompts/implement.md",
      verify: "./prompts/verify.md",
      mr: "./prompts/mr.md",
    },
    reviewer: "jsmith",
    allowedCommands: ["git", "glab", "sbt compile", "sbt test"],
    variables: {},
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as PipelineContext["logger"];

  return {
    config: makeConfig(),
    configDir: "/config",
    repoDir: "/tmp/repo",
    handoffDir: os.tmpdir(),
    gitlabToken: "glpat-test-token-12345",
    timeoutMs: 60000,
    logger,
    ...overrides,
  };
}

function makeBeadResult(overrides = {}) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      session_id: "sess-1",
      duration_ms: 1000,
      total_cost_usd: 0.05,
      result: "done",
      is_error: false,
      num_turns: 3,
    }),
    stderr: "",
    durationMs: 1000,
    costUsd: 0.05,
    timedOut: false,
    ...overrides,
  };
}

function makeAnalysisJson(result: "IMPROVEMENT_FOUND" | "NO_IMPROVEMENT", overrides = {}): string {
  if (result === "IMPROVEMENT_FOUND") {
    const analysis: AnalysisResult = {
      result: "IMPROVEMENT_FOUND",
      categoryUsed: "tests",
      candidates: [
        {
          rank: 1,
          files: ["src/foo.ts"],
          description: "Add unit tests for foo module",
          rationale: "No tests exist for this module",
        },
      ],
      selected: {
        rank: 1,
        files: ["src/foo.ts"],
        description: "Add unit tests for foo module",
        rationale: "No tests exist for this module",
      },
      ...overrides,
    };
    return JSON.stringify(analysis);
  } else {
    return JSON.stringify({
      result: "NO_IMPROVEMENT",
      categoryUsed: "tests",
      reason: "All paths covered",
      ...overrides,
    });
  }
}

function makeVerifyJson(passed: boolean, errorDetails = ""): string {
  return JSON.stringify({
    passed,
    error_details: errorDetails,
  });
}

function makeMrBeadResult(mrUrl: string): ReturnType<typeof makeBeadResult> {
  return makeBeadResult({
    stdout: JSON.stringify({
      session_id: "sess-mr",
      duration_ms: 2000,
      total_cost_usd: 0.02,
      result: `MR created: ${mrUrl}`,
      is_error: false,
      num_turns: 5,
    }),
    durationMs: 2000,
    costUsd: 0.02,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: loadBeadPrompt returns a safe prompt
  mockLoadBeadPrompt.mockResolvedValue("SECURITY CONTEXT\n---\nTest prompt");

  // Default: spawnWithTimeout resolves (for git reset --hard HEAD)
  mockSpawnWithTimeout.mockReturnValue({
    process: {} as never,
    result: Promise.resolve({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
    }),
  });

  // Default: fs.writeFile succeeds
  mockFsWriteFile.mockResolvedValue(undefined);
});

describe("runCodeAgentPipeline", () => {
  describe("happy path — full pipeline succeeds", () => {
    it("returns MR_CREATED with URL when full bead sequence succeeds", async () => {
      mockResolveCategory.mockReturnValue("tests");

      const mrUrl = "https://gitlab.com/team/repo/-/merge_requests/42";

      // Analyze returns IMPROVEMENT_FOUND
      // Verify returns passed
      // MR returns URL
      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze
        .mockResolvedValueOnce(makeBeadResult()) // implement
        .mockResolvedValueOnce(makeBeadResult()) // verify
        .mockResolvedValueOnce(makeMrBeadResult(mrUrl)); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never) // analyze handoff
        .mockResolvedValueOnce(makeVerifyJson(true) as never) // verify handoff
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never); // mr reads analysis for short_description

      const ctx = makeCtx();
      const result = await runCodeAgentPipeline(ctx);

      expect(result.outcome).toBe("MR_CREATED");
      expect(result.mrUrl).toBe(mrUrl);
      expect(result.categoryUsed).toBe("tests");
      expect(result.isFallback).toBe(false);
      expect(result.totalCostUsd).toBeGreaterThan(0);
      expect(result.totalDurationMs).toBeGreaterThan(0);
    });

    it("accumulates cost and duration across all beads", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult({ costUsd: 0.10, durationMs: 5000 })) // analyze
        .mockResolvedValueOnce(makeBeadResult({ costUsd: 0.20, durationMs: 10000 })) // implement
        .mockResolvedValueOnce(makeBeadResult({ costUsd: 0.05, durationMs: 3000 })) // verify
        .mockResolvedValueOnce(makeBeadResult({ costUsd: 0.02, durationMs: 2000 })); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx();
      const result = await runCodeAgentPipeline(ctx);

      expect(result.totalCostUsd).toBeCloseTo(0.37, 5);
      expect(result.totalDurationMs).toBe(20000);
    });
  });

  describe("NO_IMPROVEMENT — primary category + fallback", () => {
    it("returns MR_CREATED with isFallback=true when primary NO_IMPROVEMENT and fallback succeeds", async () => {
      mockResolveCategory.mockReturnValue("tests");

      const mrUrl = "https://gitlab.com/team/repo/-/merge_requests/10";

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze tests -> NO_IMPROVEMENT
        .mockResolvedValueOnce(makeBeadResult()) // analyze refactoring -> IMPROVEMENT_FOUND
        .mockResolvedValueOnce(makeBeadResult()) // implement
        .mockResolvedValueOnce(makeBeadResult()) // verify
        .mockResolvedValueOnce(makeMrBeadResult(mrUrl)); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("NO_IMPROVEMENT") as never) // tests analyze handoff
        .mockResolvedValueOnce(
          makeAnalysisJson("IMPROVEMENT_FOUND", { categoryUsed: "refactoring" }) as never,
        ) // refactoring analyze handoff
        .mockResolvedValueOnce(makeVerifyJson(true) as never) // verify handoff
        .mockResolvedValueOnce(
          makeAnalysisJson("IMPROVEMENT_FOUND", { categoryUsed: "refactoring" }) as never,
        ); // mr reads analysis

      const ctx = makeCtx();
      const result = await runCodeAgentPipeline(ctx);

      expect(result.outcome).toBe("MR_CREATED");
      expect(result.isFallback).toBe(true);
      expect(result.categoryUsed).toBe("refactoring (fallback from tests)");
      expect(result.mrUrl).toBe(mrUrl);
    });

    it("categoryUsed includes fallback notation: '{category} (fallback from {primary})'", async () => {
      mockResolveCategory.mockReturnValue("security");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze security -> NO_IMPROVEMENT
        .mockResolvedValueOnce(makeBeadResult()) // analyze tests -> IMPROVEMENT_FOUND
        .mockResolvedValueOnce(makeBeadResult()) // implement
        .mockResolvedValueOnce(makeBeadResult()) // verify
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/r/-/merge_requests/1"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("NO_IMPROVEMENT") as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.categoryUsed).toBe("tests (fallback from security)");
    });
  });

  describe("all categories exhausted", () => {
    it("returns NO_IMPROVEMENT with summary when every Analyze returns NO_IMPROVEMENT", async () => {
      mockResolveCategory.mockReturnValue("tests");

      // 5 analyze calls, each NO_IMPROVEMENT (tests + 4 fallbacks)
      mockRunBead.mockResolvedValue(makeBeadResult());

      mockFsReadFile.mockResolvedValue(makeAnalysisJson("NO_IMPROVEMENT") as never);

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.outcome).toBe("NO_IMPROVEMENT");
      expect(result.categoryUsed).toBe("tests");
      expect(result.isFallback).toBe(false);
      // Summary should mention all 5 categories
      expect(result.summary).toContain("tests");
      expect(result.summary).toContain("refactoring");
      expect(result.summary).toContain("docs");
      expect(result.summary).toContain("security");
      expect(result.summary).toContain("performance");
      // Reason should describe exhaustion
      expect(result.reason).toContain("All categories exhausted");
    });

    it("runBead is called exactly 5 times (once per category) when all NO_IMPROVEMENT", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead.mockResolvedValue(makeBeadResult());
      mockFsReadFile.mockResolvedValue(makeAnalysisJson("NO_IMPROVEMENT") as never);

      await runCodeAgentPipeline(makeCtx());

      // Only analyze beads — no implement/verify/mr
      expect(mockRunBead).toHaveBeenCalledTimes(5);
      // All calls should be analyze beads
      for (let i = 0; i < 5; i++) {
        expect(mockRunBead.mock.calls[i][0].beadName).toBe("analyze");
      }
    });
  });

  describe("Implement retry logic", () => {
    it("returns MR_CREATED when first Verify fails but second attempt passes", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze
        .mockResolvedValueOnce(makeBeadResult()) // implement attempt 1
        .mockResolvedValueOnce(makeBeadResult()) // verify attempt 1 -> fail
        .mockResolvedValueOnce(makeBeadResult()) // implement attempt 2
        .mockResolvedValueOnce(makeBeadResult()) // verify attempt 2 -> pass
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/5")); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never) // analyze
        .mockResolvedValueOnce(makeVerifyJson(false, "sbt test failed") as never) // verify 1 -> fail
        .mockResolvedValueOnce(makeVerifyJson(true) as never) // verify 2 -> pass
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never); // mr reads analysis

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.outcome).toBe("MR_CREATED");
      // implement called twice, verify called twice
      const implementCalls = mockRunBead.mock.calls.filter(
        (c) => c[0].beadName === "implement",
      );
      const verifyCalls = mockRunBead.mock.calls.filter(
        (c) => c[0].beadName === "verify",
      );
      expect(implementCalls.length).toBe(2);
      expect(verifyCalls.length).toBe(2);
    });

    it("falls back to next category when all 3 Implement+Verify attempts fail", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        // tests: analyze -> IMPROVEMENT_FOUND; then 3x implement+verify fail
        .mockResolvedValueOnce(makeBeadResult()) // analyze tests
        .mockResolvedValueOnce(makeBeadResult()) // implement attempt 1
        .mockResolvedValueOnce(makeBeadResult()) // verify attempt 1 -> fail
        .mockResolvedValueOnce(makeBeadResult()) // implement attempt 2
        .mockResolvedValueOnce(makeBeadResult()) // verify attempt 2 -> fail
        .mockResolvedValueOnce(makeBeadResult()) // implement attempt 3
        .mockResolvedValueOnce(makeBeadResult()) // verify attempt 3 -> fail
        // refactoring: analyze -> IMPROVEMENT_FOUND; implement+verify pass; mr
        .mockResolvedValueOnce(makeBeadResult()) // analyze refactoring
        .mockResolvedValueOnce(makeBeadResult()) // implement refactoring
        .mockResolvedValueOnce(makeBeadResult()) // verify refactoring
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/99")); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never) // tests analyze
        .mockResolvedValueOnce(makeVerifyJson(false, "error 1") as never) // verify 1
        .mockResolvedValueOnce(makeVerifyJson(false, "error 2") as never) // verify 2
        .mockResolvedValueOnce(makeVerifyJson(false, "error 3") as never) // verify 3
        .mockResolvedValueOnce(
          makeAnalysisJson("IMPROVEMENT_FOUND", { categoryUsed: "refactoring" }) as never,
        ) // refactoring analyze
        .mockResolvedValueOnce(makeVerifyJson(true) as never) // refactoring verify
        .mockResolvedValueOnce(
          makeAnalysisJson("IMPROVEMENT_FOUND", { categoryUsed: "refactoring" }) as never,
        ); // mr reads analysis

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.outcome).toBe("MR_CREATED");
      expect(result.isFallback).toBe(true);
      expect(result.categoryUsed).toBe("refactoring (fallback from tests)");
    });
  });

  describe("git reset between retries", () => {
    it("calls spawnWithTimeout with git reset --hard HEAD between retry attempts", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze
        .mockResolvedValueOnce(makeBeadResult()) // implement 1
        .mockResolvedValueOnce(makeBeadResult()) // verify 1 -> fail
        .mockResolvedValueOnce(makeBeadResult()) // implement 2
        .mockResolvedValueOnce(makeBeadResult()) // verify 2 -> pass
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/1")); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(false, "compile error") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx();
      await runCodeAgentPipeline(ctx);

      // git reset --hard HEAD should have been called once (before retry attempt 2)
      const resetCalls = mockSpawnWithTimeout.mock.calls.filter(
        (c) => c[0] === "git" && c[1]?.[0] === "reset",
      );
      expect(resetCalls.length).toBe(1);
      expect(resetCalls[0][0]).toBe("git");
      expect(resetCalls[0][1]).toEqual(["reset", "--hard", "HEAD"]);
    });

    it("calls git reset once per failed verify before the next attempt", async () => {
      mockResolveCategory.mockReturnValue("tests");

      // 3 attempts all fail, then fallback category succeeds
      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze tests
        .mockResolvedValueOnce(makeBeadResult()) // implement 1
        .mockResolvedValueOnce(makeBeadResult()) // verify 1 fail
        .mockResolvedValueOnce(makeBeadResult()) // implement 2
        .mockResolvedValueOnce(makeBeadResult()) // verify 2 fail
        .mockResolvedValueOnce(makeBeadResult()) // implement 3
        .mockResolvedValueOnce(makeBeadResult()) // verify 3 fail
        .mockResolvedValueOnce(makeBeadResult()) // analyze refactoring
        .mockResolvedValueOnce(makeBeadResult()) // implement refactoring
        .mockResolvedValueOnce(makeBeadResult()) // verify refactoring pass
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/2")); // mr

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(false) as never)
        .mockResolvedValueOnce(makeVerifyJson(false) as never)
        .mockResolvedValueOnce(makeVerifyJson(false) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      await runCodeAgentPipeline(makeCtx());

      const resetCalls = mockSpawnWithTimeout.mock.calls.filter(
        (c) => c[0] === "git" && c[1]?.[0] === "reset",
      );
      // 2 resets during retries + 1 reset after all retries fail before fallback
      expect(resetCalls.length).toBe(3);
    });
  });

  describe("GITLAB_TOKEN isolation (AGENT-08)", () => {
    it("does not pass gitlabToken to analyze bead", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze
        .mockResolvedValueOnce(makeBeadResult()) // implement
        .mockResolvedValueOnce(makeBeadResult()) // verify
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/1"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx({ gitlabToken: "glpat-secret-token" });
      await runCodeAgentPipeline(ctx);

      const analyzeCall = mockRunBead.mock.calls.find(
        (c) => c[0].beadName === "analyze",
      );
      expect(analyzeCall).toBeDefined();
      expect(analyzeCall![0].gitlabToken).toBeUndefined();
    });

    it("does not pass gitlabToken to implement bead", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/1"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx({ gitlabToken: "glpat-secret-token" });
      await runCodeAgentPipeline(ctx);

      const implementCall = mockRunBead.mock.calls.find(
        (c) => c[0].beadName === "implement",
      );
      expect(implementCall).toBeDefined();
      expect(implementCall![0].gitlabToken).toBeUndefined();
    });

    it("does not pass gitlabToken to verify bead", async () => {
      mockResolveCategory.mockReturnValue("tests");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/1"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx({ gitlabToken: "glpat-secret-token" });
      await runCodeAgentPipeline(ctx);

      const verifyCall = mockRunBead.mock.calls.find(
        (c) => c[0].beadName === "verify",
      );
      expect(verifyCall).toBeDefined();
      expect(verifyCall![0].gitlabToken).toBeUndefined();
    });

    it("ONLY passes gitlabToken to the mr bead", async () => {
      mockResolveCategory.mockReturnValue("tests");

      const token = "glpat-secret-token";

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeBeadResult())
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/1"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const ctx = makeCtx({ gitlabToken: token });
      await runCodeAgentPipeline(ctx);

      const mrCall = mockRunBead.mock.calls.find(
        (c) => c[0].beadName === "mr",
      );
      expect(mrCall).toBeDefined();
      expect(mrCall![0].gitlabToken).toBe(token);

      // Double-check non-MR beads don't have token
      const nonMrCalls = mockRunBead.mock.calls.filter(
        (c) => c[0].beadName !== "mr",
      );
      for (const call of nonMrCalls) {
        expect(call[0].gitlabToken).toBeUndefined();
      }
    });
  });

  describe("no category scheduled", () => {
    it("returns NO_IMPROVEMENT immediately when resolveCategory returns undefined", async () => {
      mockResolveCategory.mockReturnValue(undefined);

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.outcome).toBe("NO_IMPROVEMENT");
      expect(result.categoryUsed).toBe("none");
      expect(result.reason).toContain("No category scheduled");
      expect(result.totalCostUsd).toBe(0);
      expect(result.totalDurationMs).toBe(0);
      // No beads should be invoked
      expect(mockRunBead).not.toHaveBeenCalled();
    });
  });

  describe("category fallback order", () => {
    it("tries categories in order: primary, tests, refactoring, docs, security, performance (minus primary)", async () => {
      mockResolveCategory.mockReturnValue("docs");

      // All categories return NO_IMPROVEMENT
      mockRunBead.mockResolvedValue(makeBeadResult());
      mockFsReadFile.mockResolvedValue(makeAnalysisJson("NO_IMPROVEMENT") as never);

      await runCodeAgentPipeline(makeCtx());

      const analyzeCalls = mockRunBead.mock.calls.filter(
        (c) => c[0].beadName === "analyze",
      );

      // Expected order: docs (primary), tests, refactoring, security, performance
      // (docs skipped in fallback since it's primary)
      expect(analyzeCalls.length).toBe(5);

      // Verify the category vars passed to loadBeadPrompt
      const promptCalls = mockLoadBeadPrompt.mock.calls;
      // Each analyze call triggers a loadBeadPrompt for the analyze template
      const analyzepPromptCalls = promptCalls.filter(
        (c) => String(c[0]).includes("analyze"),
      );
      expect(analyzepPromptCalls.length).toBe(5);

      // Check the category var in each call's vars
      const categoriesUsed = analyzepPromptCalls.map(
        (c) => (c[1] as Record<string, string>).category,
      );
      expect(categoriesUsed[0]).toBe("docs");
      expect(categoriesUsed).toContain("tests");
      expect(categoriesUsed).toContain("refactoring");
      expect(categoriesUsed).toContain("security");
      expect(categoriesUsed).toContain("performance");
      // docs should only appear once (primary, not repeated in fallback)
      expect(categoriesUsed.filter((c) => c === "docs").length).toBe(1);
    });
  });

  describe("notification category reflects fallback", () => {
    it("categoryUsed in result includes fallback notation when fallback is used", async () => {
      mockResolveCategory.mockReturnValue("performance");

      mockRunBead
        .mockResolvedValueOnce(makeBeadResult()) // analyze performance -> NO_IMPROVEMENT
        .mockResolvedValueOnce(makeBeadResult()) // analyze tests -> IMPROVEMENT_FOUND
        .mockResolvedValueOnce(makeBeadResult()) // implement
        .mockResolvedValueOnce(makeBeadResult()) // verify
        .mockResolvedValueOnce(makeMrBeadResult("https://gitlab.com/-/mr/3"));

      mockFsReadFile
        .mockResolvedValueOnce(makeAnalysisJson("NO_IMPROVEMENT") as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never)
        .mockResolvedValueOnce(makeVerifyJson(true) as never)
        .mockResolvedValueOnce(makeAnalysisJson("IMPROVEMENT_FOUND") as never);

      const result = await runCodeAgentPipeline(makeCtx());

      expect(result.categoryUsed).toBe("tests (fallback from performance)");
      expect(result.isFallback).toBe(true);
    });
  });
});

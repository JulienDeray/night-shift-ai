import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock cloneRepo before importing the module under test
vi.mock("../../src/agent/git-harness.js", () => ({
  cloneRepo: vi.fn(),
  cleanupDir: vi.fn(),
}));

import { cloneRepo } from "../../src/agent/git-harness.js";
import { GitCloneBeadPlugin } from "../../src/agent/plugins/git-clone-bead-plugin.js";
import type { AgentPipelineContext } from "../../src/agent/bead-plugin.js";
import type { ResolvedBead, LoadedManifest } from "../../src/agent/manifest-types.js";

const mockCloneRepo = vi.mocked(cloneRepo);

// Minimal compiled schema for test beads
const MINIMAL_SCHEMA = z.fromJSONSchema({
  type: "object",
  properties: { repoDir: { type: "string" } },
}) as z.ZodTypeAny;

function makeResolvedBead(overrides: Partial<ResolvedBead> = {}): ResolvedBead {
  return {
    name: "git-clone",
    type: "git-clone",
    prompt: "",
    model: "claude-sonnet-4-5",
    timeout: "10m",
    allowedTools: [],
    env: [],
    outputSchema: {},
    compiledOutputSchema: MINIMAL_SCHEMA,
    ...overrides,
  };
}

function makeManifest(): LoadedManifest {
  return {
    name: "test-agent",
    description: "Test agent",
    agentDir: "/tmp/agent",
    variables: {},
    beads: [],
  };
}

function makeContext(overrides: Partial<AgentPipelineContext> = {}): AgentPipelineContext {
  return {
    taskId: "task-abc",
    agentName: "test-agent",
    agentDir: "/tmp/agent",
    workDir: "/tmp/nightshift-run123/repo",
    handoffDir: "/tmp/nightshift-run123/handoff",
    manifest: makeManifest(),
    currentBead: makeResolvedBead(),
    previousBeads: {},
    variables: { repo_url: "git@gitlab.com:team/repo.git" },
    ...overrides,
  };
}

describe("GitCloneBeadPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rawOutput as JSON with repoDir and handoffDir on success", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/x",
      handoffDir: "/tmp/y",
    });

    const plugin = new GitCloneBeadPlugin();
    const result = await plugin.execute(makeContext());

    const payload = JSON.stringify({ repoDir: "/tmp/x", handoffDir: "/tmp/y" });
    expect(result.rawOutput).toBe("```json\n" + payload + "\n```");
  });

  it("throws when repo_url variable is missing", async () => {
    const plugin = new GitCloneBeadPlugin();
    const ctx = makeContext({ variables: {} });

    await expect(plugin.execute(ctx)).rejects.toThrow(
      "GitCloneBeadPlugin requires 'repo_url' variable",
    );
  });

  it("throws when repo_url variable is not a string", async () => {
    const plugin = new GitCloneBeadPlugin();
    const ctx = makeContext({ variables: { repo_url: 42 } });

    await expect(plugin.execute(ctx)).rejects.toThrow(
      "GitCloneBeadPlugin requires 'repo_url' variable",
    );
  });

  it("forwards GITLAB_TOKEN when env includes GITLAB_TOKEN entry", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/x",
      handoffDir: "/tmp/y",
    });

    const bead = makeResolvedBead({
      env: [{ name: "GITLAB_TOKEN", value: "secret-token" }],
    });
    const plugin = new GitCloneBeadPlugin();
    const ctx = makeContext({ currentBead: bead });
    await plugin.execute(ctx);

    expect(mockCloneRepo).toHaveBeenCalledWith(
      "git@gitlab.com:team/repo.git",
      "secret-token",
      "/tmp/nightshift-run123/repo",
    );
  });

  it("passes gitlabToken as undefined when env has no GITLAB_TOKEN entry", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/tmp/x",
      handoffDir: "/tmp/y",
    });

    const plugin = new GitCloneBeadPlugin();
    await plugin.execute(makeContext());

    expect(mockCloneRepo).toHaveBeenCalledWith(
      "git@gitlab.com:team/repo.git",
      undefined,
      "/tmp/nightshift-run123/repo",
    );
  });

  it("passes ctx.workDir as the repoDir argument to cloneRepo", async () => {
    mockCloneRepo.mockResolvedValue({
      repoDir: "/custom/work/dir",
      handoffDir: "/tmp/handoff",
    });

    const plugin = new GitCloneBeadPlugin();
    const ctx = makeContext({ workDir: "/custom/work/dir" });
    await plugin.execute(ctx);

    const [, , calledRepoDir] = mockCloneRepo.mock.calls[0];
    expect(calledRepoDir).toBe("/custom/work/dir");
  });

  it("propagates errors thrown by cloneRepo", async () => {
    mockCloneRepo.mockRejectedValue(new Error("git clone failed (exit 128): not found"));

    const plugin = new GitCloneBeadPlugin();
    await expect(plugin.execute(makeContext())).rejects.toThrow("git clone failed");
  });
});

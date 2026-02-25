import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";

// Mock dependencies before importing the module under test
vi.mock("node:fs/promises", () => ({
  default: {
    mkdtemp: vi.fn(),
    rm: vi.fn(),
  },
}));

vi.mock("node:os", () => ({
  default: {
    tmpdir: vi.fn(),
  },
}));

vi.mock("../../src/utils/process.js", () => ({
  spawnWithTimeout: vi.fn(),
}));

import fs from "node:fs/promises";
import { cloneRepo, cleanupDir } from "../../src/agent/git-harness.js";
import { spawnWithTimeout } from "../../src/utils/process.js";

const mockFsMkdtemp = vi.mocked(fs.mkdtemp);
const mockFsRm = vi.mocked(fs.rm);
const mockOsTmpdir = vi.mocked(os.tmpdir);
const mockSpawnWithTimeout = vi.mocked(spawnWithTimeout);

describe("git-harness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOsTmpdir.mockReturnValue("/tmp");
  });

  describe("cloneRepo", () => {
    it("creates two temp dirs with night-shift-repo- and night-shift-handoff- prefixes under os.tmpdir()", async () => {
      const repoDir = "/tmp/night-shift-repo-abc123-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc123-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      await cloneRepo("git@gitlab.com:team/repo.git", undefined);

      expect(mockFsMkdtemp).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = mockFsMkdtemp.mock.calls;
      expect(firstCall[0]).toContain("night-shift-repo-");
      expect(firstCall[0]).toContain("/tmp");
      expect(secondCall[0]).toContain("night-shift-handoff-");
      expect(secondCall[0]).toContain("/tmp");
    });

    it("calls spawnWithTimeout with git clone --depth 1 and correct env", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      const repoUrl = "git@gitlab.com:team/repo.git";
      await cloneRepo(repoUrl, undefined);

      expect(mockSpawnWithTimeout).toHaveBeenCalledOnce();
      const [command, args, options] = mockSpawnWithTimeout.mock.calls[0];
      expect(command).toBe("git");
      expect(args).toEqual(["clone", "--depth", "1", repoUrl, repoDir]);
      expect(options?.env).toMatchObject({
        GIT_CONFIG_NOSYSTEM: "1",
      });
      expect(options?.env).toHaveProperty("HOME");
      expect(options?.env).toHaveProperty("PATH");
    });

    it("returns { repoDir, handoffDir } on success (exitCode 0)", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      const result = await cloneRepo("git@gitlab.com:team/repo.git", undefined);

      expect(result).toEqual({ repoDir, handoffDir });
    });

    it("calls fs.rm on both dirs and throws on clone failure (exitCode 128)", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
      mockFsRm.mockResolvedValue(undefined);
      mockSpawnWithTimeout.mockReturnValue({
        process: {} as never,
        result: Promise.resolve({
          stdout: "",
          stderr: "fatal: repository not found",
          exitCode: 128,
          signal: null,
          timedOut: false,
        }),
      });

      await expect(
        cloneRepo("git@gitlab.com:team/repo.git", undefined),
      ).rejects.toThrow("git clone failed");

      expect(mockFsRm).toHaveBeenCalledWith(repoDir, {
        recursive: true,
        force: true,
      });
      expect(mockFsRm).toHaveBeenCalledWith(handoffDir, {
        recursive: true,
        force: true,
      });
    });

    it("does NOT include GITLAB_TOKEN in env when gitlabToken is undefined", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      await cloneRepo("git@gitlab.com:team/repo.git", undefined);

      const options = mockSpawnWithTimeout.mock.calls[0][2];
      expect(options?.env).not.toHaveProperty("GITLAB_TOKEN");
    });

    it("includes GITLAB_TOKEN in env when gitlabToken is provided", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      await cloneRepo("git@gitlab.com:team/repo.git", "my-secret-token");

      const options = mockSpawnWithTimeout.mock.calls[0][2];
      expect(options?.env).toHaveProperty("GITLAB_TOKEN", "my-secret-token");
    });

    it("preserves SSH_AUTH_SOCK in clone env", async () => {
      const repoDir = "/tmp/night-shift-repo-abc-xyz";
      const handoffDir = "/tmp/night-shift-handoff-abc-pqr";
      mockFsMkdtemp
        .mockResolvedValueOnce(repoDir)
        .mockResolvedValueOnce(handoffDir);
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

      await cloneRepo("git@gitlab.com:team/repo.git", undefined);

      const options = mockSpawnWithTimeout.mock.calls[0][2];
      // SSH_AUTH_SOCK is explicitly forwarded (may be undefined if not set in test env)
      expect("SSH_AUTH_SOCK" in (options?.env ?? {})).toBe(true);
    });
  });

  describe("cleanupDir", () => {
    it("calls fs.rm with recursive: true and force: true", async () => {
      mockFsRm.mockResolvedValue(undefined);

      await cleanupDir("/tmp/some-dir");

      expect(mockFsRm).toHaveBeenCalledWith("/tmp/some-dir", {
        recursive: true,
        force: true,
      });
    });

    it("does NOT throw even when fs.rm rejects", async () => {
      mockFsRm.mockRejectedValue(new Error("EPERM: permission denied"));

      await expect(cleanupDir("/tmp/some-dir")).resolves.toBeUndefined();
    });
  });
});

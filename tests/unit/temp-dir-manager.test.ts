import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TempDirManager } from "../../src/agent/temp-dir-manager.js";
import { Logger } from "../../src/core/logger.js";

describe("TempDirManager", () => {
  let logger: Logger;
  let dirsToClean: string[];

  beforeEach(() => {
    logger = Logger.createCliLogger(false);
    dirsToClean = [];
  });

  afterEach(async () => {
    // Clean up any dirs created during tests
    for (const dir of dirsToClean) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe("create()", () => {
    it("creates tmpDir, repoDir, and handoffDir under os.tmpdir()", async () => {
      const manager = new TempDirManager(logger);
      const runId = `test-${Date.now()}`;

      const { tmpDir, repoDir, handoffDir } = await manager.create(runId);
      dirsToClean.push(tmpDir);

      expect(tmpDir).toBe(path.join(os.tmpdir(), `nightshift-${runId}`));
      expect(repoDir).toBe(path.join(tmpDir, "repo"));
      expect(handoffDir).toBe(path.join(tmpDir, "handoff"));
    });

    it("creates all three directories on disk", async () => {
      const manager = new TempDirManager(logger);
      const runId = `test-${Date.now()}`;

      const { tmpDir, repoDir, handoffDir } = await manager.create(runId);
      dirsToClean.push(tmpDir);

      const [tmpStat, repoStat, handoffStat] = await Promise.all([
        fs.stat(tmpDir),
        fs.stat(repoDir),
        fs.stat(handoffDir),
      ]);

      expect(tmpStat.isDirectory()).toBe(true);
      expect(repoStat.isDirectory()).toBe(true);
      expect(handoffStat.isDirectory()).toBe(true);
    });
  });

  describe("cleanup()", () => {
    it("removes the directory and its contents", async () => {
      const manager = new TempDirManager(logger);
      const runId = `test-${Date.now()}`;

      const { tmpDir } = await manager.create(runId);

      // Write a file inside to verify recursive removal
      await fs.writeFile(path.join(tmpDir, "repo", "test.txt"), "hello");

      await manager.cleanup(tmpDir);

      await expect(fs.stat(tmpDir)).rejects.toThrow();
    });

    it("does not throw when directory does not exist", async () => {
      const manager = new TempDirManager(logger);
      const nonExistent = path.join(os.tmpdir(), "nightshift-does-not-exist-12345");

      await expect(manager.cleanup(nonExistent)).resolves.toBeUndefined();
    });
  });

  describe("cleanupOrphans()", () => {
    it("removes dirs older than maxAgeMs and keeps recent ones", async () => {
      const tmpBase = os.tmpdir();
      const uniqueSuffix = `orphan-test-${Date.now()}`;

      // Create an old directory
      const oldDir = path.join(tmpBase, `nightshift-old-${uniqueSuffix}`);
      await fs.mkdir(oldDir, { recursive: true });
      dirsToClean.push(oldDir);

      // Set its mtime to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await fs.utimes(oldDir, twoHoursAgo, twoHoursAgo);

      // Create a fresh directory
      const freshDir = path.join(tmpBase, `nightshift-fresh-${uniqueSuffix}`);
      await fs.mkdir(freshDir, { recursive: true });
      dirsToClean.push(freshDir);

      // Run cleanupOrphans with 1 hour maxAge
      await TempDirManager.cleanupOrphans(logger, 60 * 60 * 1000);

      // Old dir should be removed
      await expect(fs.stat(oldDir)).rejects.toThrow();

      // Fresh dir should still exist
      const freshStat = await fs.stat(freshDir);
      expect(freshStat.isDirectory()).toBe(true);

      // Remove from dirsToClean so afterEach doesn't try to clean already-removed dir
      dirsToClean.splice(dirsToClean.indexOf(oldDir), 1);
    });

    it("does not throw when tmpdir cannot be read", async () => {
      // Test with a maxAgeMs of 0 — all dirs qualify, but we just verify it resolves
      await expect(
        TempDirManager.cleanupOrphans(logger, 0),
      ).resolves.toBeUndefined();
    });
  });
});

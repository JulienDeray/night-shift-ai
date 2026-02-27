import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Logger } from "../core/logger.js";

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Manages temporary directories for AgentEngine pipeline runs.
 *
 * Each run gets an isolated `/tmp/nightshift-{runId}/` directory with
 * `repo/` and `handoff/` subdirectories. The engine owns the lifecycle
 * of these directories.
 *
 * Cleanup failures are treated as warnings (never rethrown) per the
 * locked CONTEXT.md decision: rollback failures must not mask the
 * original error or prevent the engine from returning a result.
 */
export class TempDirManager {
  constructor(private readonly logger: Logger) {}

  /**
   * Creates the run-scoped temp directory structure:
   *   /tmp/nightshift-{runId}/
   *   /tmp/nightshift-{runId}/repo/
   *   /tmp/nightshift-{runId}/handoff/
   *
   * Returns the paths to all three directories.
   */
  async create(runId: string): Promise<{
    tmpDir: string;
    repoDir: string;
    handoffDir: string;
  }> {
    const tmpDir = path.join(os.tmpdir(), `nightshift-${runId}`);
    const repoDir = path.join(tmpDir, "repo");
    const handoffDir = path.join(tmpDir, "handoff");

    await fs.mkdir(tmpDir, { recursive: true });
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(handoffDir, { recursive: true });

    return { tmpDir, repoDir, handoffDir };
  }

  /**
   * Removes the run-scoped temp directory.
   *
   * Never throws — cleanup failures are logged as warnings only.
   * The engine must not propagate cleanup errors to callers.
   */
  async cleanup(tmpDir: string): Promise<void> {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn("TempDirManager: failed to clean up temp dir", {
        tmpDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Scans os.tmpdir() for orphaned `nightshift-*` directories and removes
   * any that are older than `maxAgeMs` (default: 1 hour).
   *
   * Static because it runs at daemon start before any engine instance exists.
   * Logs the count of directories cleaned.
   */
  static async cleanupOrphans(
    logger: Logger,
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  ): Promise<void> {
    const tmpBase = os.tmpdir();
    let entries: string[];

    try {
      const dirents = await fs.readdir(tmpBase, { withFileTypes: true });
      entries = dirents
        .filter((d) => d.isDirectory() && d.name.startsWith("nightshift-"))
        .map((d) => d.name);
    } catch (err) {
      logger.warn("TempDirManager: failed to scan tmpdir for orphans", {
        tmpBase,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const name of entries) {
      const fullPath = path.join(tmpBase, name);
      try {
        const stat = await fs.stat(fullPath);
        const ageMs = now - stat.mtimeMs;
        if (ageMs > maxAgeMs) {
          await fs.rm(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch (err) {
        logger.warn("TempDirManager: failed to clean orphaned dir", {
          fullPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (cleaned > 0) {
      logger.info("TempDirManager: cleaned orphaned temp dirs", { count: cleaned });
    }
  }
}

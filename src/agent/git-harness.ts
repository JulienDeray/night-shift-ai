import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnWithTimeout } from "../utils/process.js";

export interface CloneResult {
  repoDir: string;
  handoffDir: string;
}

/**
 * Clones a repository into a temp directory.
 *
 * When `repoDir` is provided, the caller-supplied path is used directly
 * (no mkdtemp). On clone failure with a caller-provided repoDir, that
 * directory is NOT cleaned up — the caller owns its lifecycle. Only
 * handoffDir is cleaned on failure in that case.
 *
 * When `repoDir` is omitted, behavior is unchanged (mkdtemp, cleanup both
 * on failure).
 */
export async function cloneRepo(
  repoUrl: string,
  gitlabToken: string | undefined,
  repoDir?: string,
): Promise<CloneResult> {
  const callerProvidedRepoDir = repoDir !== undefined;

  const runId = Date.now().toString(36);
  const resolvedRepoDir = callerProvidedRepoDir
    ? repoDir
    : await fs.mkdtemp(
        path.join(os.tmpdir(), `night-shift-repo-${runId}-`),
      );
  const handoffDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `night-shift-handoff-${runId}-`),
  );

  const cloneEnv: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    GIT_CONFIG_NOSYSTEM: "1",
    ...(gitlabToken ? { GITLAB_TOKEN: gitlabToken } : {}),
  };

  const { result } = spawnWithTimeout(
    "git",
    ["clone", "--depth", "50", repoUrl, resolvedRepoDir],
    { env: cloneEnv },
  );

  const cloneResult = await result;
  if (cloneResult.exitCode !== 0) {
    // Only clean up repoDir if we created it (not caller-provided)
    if (!callerProvidedRepoDir) {
      await cleanupDir(resolvedRepoDir);
    }
    await cleanupDir(handoffDir);
    throw new Error(
      `git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
    );
  }

  return { repoDir: resolvedRepoDir, handoffDir };
}

export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Swallow — cleanup must not propagate and mask the original error
  }
}

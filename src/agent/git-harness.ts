import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnWithTimeout } from "../utils/process.js";

export interface CloneResult {
  repoDir: string;
  handoffDir: string;
}

export async function cloneRepo(
  repoUrl: string,
  gitlabToken: string | undefined,
): Promise<CloneResult> {
  const runId = Date.now().toString(36);
  const repoDir = await fs.mkdtemp(
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
    ["clone", "--depth", "50", repoUrl, repoDir],
    { env: cloneEnv },
  );

  const cloneResult = await result;
  if (cloneResult.exitCode !== 0) {
    await cleanupDir(repoDir);
    await cleanupDir(handoffDir);
    throw new Error(
      `git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
    );
  }

  return { repoDir, handoffDir };
}

export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Swallow — cleanup must not propagate and mask the original error
  }
}

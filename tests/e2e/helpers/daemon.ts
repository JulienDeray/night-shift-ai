import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnWithTimeout } from "../../../src/utils/process.js";
import { readDaemonState } from "../../../src/daemon/health.js";

export interface DaemonHandle {
  pid: number | undefined;
  cwd: string;
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN_PATH = path.join(PROJECT_ROOT, "bin/nightshift.ts");
const DAEMON_SRC_PATH = path.join(PROJECT_ROOT, "src/daemon/index.ts");

const POLL_INTERVAL_MS = 200;

/**
 * Starts the nightshift daemon in the given cwd.
 *
 * Spawns the daemon directly via `npx tsx src/daemon/index.ts` to avoid the
 * compiled-JS path issue in `nightshift start` (which resolves the daemon path
 * relative to its compiled __dirname). Waits for the daemon to write a fresh
 * heartbeat before returning.
 */
export async function startDaemon(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<DaemonHandle> {
  const child = spawn("npx", ["tsx", DAEMON_SRC_PATH], {
    cwd,
    env,
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  // Wait for the daemon to write a fresh heartbeat (signals it is running)
  await waitForDaemonReady(cwd);

  const state = await readDaemonState(cwd);
  return { pid: state?.pid, cwd };
}

/**
 * Polls daemon.json until status === "running" and lastHeartbeat is fresh.
 */
export async function waitForDaemonReady(
  cwd: string,
  maxWaitMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  const daemonJsonPath = path.join(cwd, ".nightshift", "daemon.json");

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(daemonJsonPath, "utf-8");
      const state = JSON.parse(raw) as { status: string; lastHeartbeat: string };
      const age = Date.now() - new Date(state.lastHeartbeat).getTime();
      if (state.status === "running" && age < 5000) return;
    } catch {
      // file not yet written — keep polling
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Daemon did not become ready within ${maxWaitMs}ms`);
}

/**
 * Stops the daemon gracefully via CLI stop command.
 */
export async function stopDaemon(cwd: string): Promise<void> {
  const { result } = spawnWithTimeout("npx", ["tsx", BIN_PATH, "stop"], {
    timeoutMs: 15_000,
    cwd,
  });
  await result;
}

/**
 * Kills the daemon with SIGKILL. Idempotent — safe to call even if already dead.
 */
export async function killDaemon(cwd: string): Promise<void> {
  const state = await readDaemonState(cwd);
  if (state?.pid) {
    try {
      process.kill(state.pid, "SIGKILL");
    } catch {
      // already dead — ignore
    }
  }
}

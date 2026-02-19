import fs from "node:fs/promises";
import { getDaemonPidPath, getDaemonStatePath } from "../core/paths.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { DaemonState } from "../core/types.js";

const STALE_THRESHOLD_MS = 60000; // 1 minute without heartbeat = stale

export async function writePidFile(pid: number, base?: string): Promise<void> {
  const pidPath = getDaemonPidPath(base);
  await fs.writeFile(pidPath, pid.toString(), "utf-8");
}

export async function removePidFile(base?: string): Promise<void> {
  try {
    await fs.unlink(getDaemonPidPath(base));
  } catch {
    // ignore
  }
}

export async function readPidFile(base?: string): Promise<number | null> {
  try {
    const content = await fs.readFile(getDaemonPidPath(base), "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function writeDaemonState(
  state: DaemonState,
  base?: string,
): Promise<void> {
  await writeJsonFile(getDaemonStatePath(base), state);
}

export async function readDaemonState(
  base?: string,
): Promise<DaemonState | null> {
  return readJsonFile<DaemonState>(getDaemonStatePath(base));
}

export function isDaemonRunning(state: DaemonState): boolean {
  if (state.status === "stopped") return false;

  // Check if process is actually alive
  try {
    process.kill(state.pid, 0);
  } catch {
    return false;
  }

  // Check for staleness
  const lastHeartbeat = new Date(state.lastHeartbeat).getTime();
  const now = Date.now();
  if (now - lastHeartbeat > STALE_THRESHOLD_MS) {
    return false;
  }

  return true;
}

export async function cleanupStaleState(base?: string): Promise<void> {
  const state = await readDaemonState(base);
  if (state && !isDaemonRunning(state)) {
    await removePidFile(base);
    await writeDaemonState({ ...state, status: "stopped" }, base);
  }
}

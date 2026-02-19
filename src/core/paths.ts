import path from "node:path";
import fs from "node:fs/promises";

const NIGHTSHIFT_DIR = ".nightshift";

export function getNightShiftDir(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR);
}

export function getConfigPath(base: string = process.cwd()): string {
  return path.resolve(base, "nightshift.yaml");
}

export function getInboxDir(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "inbox");
}

export function getQueueDir(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "queue");
}

export function getLogsDir(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "logs");
}

export function getDaemonPidPath(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "daemon.pid");
}

export function getDaemonStatePath(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "daemon.json");
}

export function getSchedulerStatePath(base: string = process.cwd()): string {
  return path.resolve(base, NIGHTSHIFT_DIR, "scheduler.json");
}

export function getWorkspaceDir(
  workspace: string,
  base: string = process.cwd(),
): string {
  return path.resolve(base, workspace);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureNightShiftDirs(
  base: string = process.cwd(),
): Promise<void> {
  await ensureDir(getNightShiftDir(base));
  await ensureDir(getInboxDir(base));
  await ensureDir(getQueueDir(base));
  await ensureDir(getLogsDir(base));
}

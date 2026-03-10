import fs from "node:fs/promises";
import path from "node:path";
import { getLogsDir, ensureDir } from "../core/paths.js";

export interface RunLogEntry {
  date: string;
  run_id: string;
  agent_name: string;
  final_output: unknown | null;
  duration_seconds: number;
  summary: string;
}

export async function appendRunLog(
  entry: RunLogEntry,
  base: string = process.cwd(),
): Promise<void> {
  const logsDir = getLogsDir(base);
  await ensureDir(logsDir);
  const logPath = path.join(logsDir, "agent-runs.jsonl");
  await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

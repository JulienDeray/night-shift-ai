import fs from "node:fs/promises";
import path from "node:path";
import { getLogsDir, ensureDir } from "../core/paths.js";

export interface RunLogEntry {
  date: string;
  category: string;
  mr_url: string | null;
  cost_usd: number;
  duration_seconds: number;
  summary: string;
}

export async function appendRunLog(
  entry: RunLogEntry,
  base: string = process.cwd(),
): Promise<void> {
  const logsDir = getLogsDir(base);
  await ensureDir(logsDir);
  const logPath = path.join(logsDir, "code-agent-runs.jsonl");
  await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

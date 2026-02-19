import path from "node:path";
import { format } from "date-fns";
import { getInboxDir, ensureDir } from "../core/paths.js";
import { atomicWrite } from "../utils/fs.js";
import { renderTemplate } from "../utils/template.js";
import type { NightShiftTask, AgentExecutionResult, InboxEntry } from "../core/types.js";

export function generateReport(
  task: NightShiftTask,
  result: AgentExecutionResult,
  startedAt: Date,
  completedAt: Date,
): string {
  const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
  const status = result.isError ? "failed" : "completed";
  const durationFormatted = formatDurationHuman(durationSeconds);

  return `---
task_id: ${task.id}
task_name: ${task.name}
origin: ${task.origin}
status: ${status}
started_at: ${startedAt.toISOString()}
completed_at: ${completedAt.toISOString()}
duration_seconds: ${durationSeconds}
cost_usd: ${result.totalCostUsd.toFixed(2)}
num_turns: ${result.numTurns}
---

# ${task.name}

**Status**: ${capitalize(status)} | **Duration**: ${durationFormatted} | **Cost**: $${result.totalCostUsd.toFixed(2)}

## Result

${result.result}

## Original Prompt

> ${task.prompt.split("\n").join("\n> ")}
`;
}

export async function writeReport(
  task: NightShiftTask,
  result: AgentExecutionResult,
  startedAt: Date,
  completedAt: Date,
  base?: string,
): Promise<string> {
  const inboxDir = getInboxDir(base);
  await ensureDir(inboxDir);

  const dateStr = format(completedAt, "yyyy-MM-dd");
  const shortId = task.id.slice(0, 8);
  const fileName = `${dateStr}_${sanitize(task.name)}_${shortId}.md`;
  const filePath = path.join(inboxDir, fileName);

  const content = generateReport(task, result, startedAt, completedAt);
  await atomicWrite(filePath, content);

  // If task has a custom output path, also write there
  if (task.output) {
    const outputPath = path.resolve(base ?? process.cwd(), renderTemplate(task.output, { name: task.name }));
    await ensureDir(path.dirname(outputPath));
    await atomicWrite(outputPath, content);
  }

  return filePath;
}

export function toInboxEntry(
  task: NightShiftTask,
  result: AgentExecutionResult,
  startedAt: Date,
  completedAt: Date,
  filePath: string,
): InboxEntry {
  return {
    taskId: task.id,
    taskName: task.name,
    origin: task.origin,
    status: result.isError ? "failed" : "completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    costUsd: result.totalCostUsd,
    numTurns: result.numTurns,
    resultSummary: result.result.slice(0, 500),
    originalPrompt: task.prompt,
    filePath,
  };
}

function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

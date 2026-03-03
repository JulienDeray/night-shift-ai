import path from "node:path";
import { format } from "date-fns";
import { getInboxDir, ensureDir } from "../core/paths.js";
import { atomicWrite } from "../utils/fs.js";
import { renderTemplate } from "../utils/template.js";
import type { NightShiftTask, InboxEntry } from "../core/types.js";
import type { AgentRunResult } from "../agent/engine-types.js";

export function generateReport(
  task: NightShiftTask,
  result: AgentRunResult,
  startedAt: Date,
  completedAt: Date,
): string {
  const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
  const status = result.status === "SUCCESS" ? "completed" : "failed";
  const durationFormatted = formatDurationHuman(durationSeconds);

  // Build per-bead summary lines
  const beadLines = result.perBead.map((bead) => {
    const errorPart = bead.error ? ` — ${bead.error.slice(0, 200)}` : "";
    return `- **${bead.name}**: ${bead.status} (${bead.durationMs}ms)${errorPart}`;
  }).join("\n");

  // Build result section
  let resultSection: string;
  if (result.finalOutput === null || result.finalOutput === undefined) {
    resultSection = result.error ?? "No output";
  } else if (typeof result.finalOutput === "string") {
    resultSection = result.finalOutput;
  } else {
    resultSection = JSON.stringify(result.finalOutput, null, 2);
  }

  return `---
task_id: ${task.id}
task_name: ${task.name}
origin: ${task.origin}
status: ${status}
started_at: ${startedAt.toISOString()}
completed_at: ${completedAt.toISOString()}
duration_seconds: ${durationSeconds}
agent_name: ${result.agentName}
bead_count: ${result.perBead.length}
---

# ${task.name}

**Status**: ${capitalize(status)} | **Duration**: ${durationFormatted} | **Agent**: ${result.agentName}

## Beads

${beadLines || "_No beads executed_"}

## Result

${resultSection}

## Original Prompt

> ${task.prompt.split("\n").join("\n> ")}
`;
}

export async function writeReport(
  task: NightShiftTask,
  result: AgentRunResult,
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
  result: AgentRunResult,
  startedAt: Date,
  completedAt: Date,
  filePath: string,
): InboxEntry {
  const resultSummary = result.finalOutput !== null && result.finalOutput !== undefined
    ? (JSON.stringify(result.finalOutput)?.slice(0, 500) ?? "")
    : (result.error?.slice(0, 500) ?? "");

  return {
    taskId: task.id,
    taskName: task.name,
    origin: task.origin,
    status: result.status === "SUCCESS" ? "completed" : "failed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    agentName: result.agentName,
    beadCount: result.perBead.length,
    resultSummary,
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

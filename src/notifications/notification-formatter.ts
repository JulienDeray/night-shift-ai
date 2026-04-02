import type { NightShiftTask } from "../core/types.js";
import type { AgentRunResult } from "../agent/engine-types.js";
import type { NtfyMessage } from "./ntfy-client.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a duration in milliseconds to a human-readable string.
 * - Under 1 minute: "45s"
 * - Under 1 hour: "3m 42s"
 * - 1 hour or more: "1h 2m"
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Extracts a one-line summary from the finalOutput field of an AgentRunResult.
 * - If output is a string: returns the first line
 * - If output is an object with a "summary" field: returns it as string
 * - If output is an object with a "result" field: returns it as string
 * - Otherwise: JSON.stringify, truncated to 200 chars
 */
function extractSummaryLine(output: unknown): string {
  if (typeof output === "string") {
    return output.split("\n")[0] ?? "";
  }
  if (output !== null && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (typeof obj["summary"] === "string") {
      return obj["summary"];
    }
    if (typeof obj["result"] === "string") {
      return obj["result"];
    }
    const json = JSON.stringify(output);
    return json.length > 200 ? json.slice(0, 200) : json;
  }
  return String(output ?? "");
}

/**
 * Cleans an error string by stripping stack trace frames.
 * Returns the first non-empty, non-stack-trace line, truncated to 200 chars.
 * Falls back to "Unknown error" if nothing meaningful remains.
 */
function cleanError(error: string | undefined): string {
  if (error === undefined || error.trim() === "") {
    return "Unknown error";
  }
  const lines = error.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip lines that look like stack frames: "    at foo.ts:12" or "at foo (bar.ts:1:2)"
    if (trimmed === "") continue;
    if (/^\s*at\s+/.test(trimmed)) continue;
    return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
  }
  return "Unknown error";
}

// ---------------------------------------------------------------------------
// Public formatter functions
// ---------------------------------------------------------------------------

/**
 * Formats a start notification for a task.
 * Title: "🕐 {agent} ▸ {task}"
 * Body: "Task started"
 * Priority: 3
 */
export function formatStartNotification(task: NightShiftTask): NtfyMessage {
  const agent = task.agentName ?? "unknown-agent";
  return {
    title: `🕐 ${agent} ▸ ${task.name}`,
    body: "Task started",
    priority: 3,
    tags: ["clock3"],
  };
}

/**
 * Formats a success notification for a completed task.
 * Title: "✅ {agent} ▸ {task}"
 * Body: "{duration} · {summary}" or just "{duration}" if summary is empty
 * Priority: 3
 */
export function formatSuccessNotification(
  task: NightShiftTask,
  result: AgentRunResult,
): NtfyMessage {
  const agent = task.agentName ?? result.agentName ?? "unknown-agent";
  const duration = formatDuration(result.totalDurationMs);
  const summary = extractSummaryLine(result.finalOutput);
  const body = summary ? `${duration} · ${summary}` : duration;
  return {
    title: `✅ ${agent} ▸ ${task.name}`,
    body,
    priority: 3,
    tags: ["white_check_mark"],
  };
}

/**
 * Formats a failure notification for a failed task.
 * Title: "❌ {agent} ▸ {task}"
 * Body: "Step '{step}' failed\n{cleaned error}"
 * Priority: 4
 */
export function formatFailureNotification(
  task: NightShiftTask,
  result: AgentRunResult,
): NtfyMessage {
  const agent = task.agentName ?? result.agentName ?? "unknown-agent";

  let stepLabel: string;
  if (result.failedStepIndex === undefined) {
    stepLabel = "unknown step failed";
  } else {
    const step = result.perStep[result.failedStepIndex];
    if (step !== undefined) {
      stepLabel = `Step '${step.name}' failed`;
    } else {
      stepLabel = `step ${result.failedStepIndex} failed`;
    }
  }

  const errorLine = cleanError(result.error);

  return {
    title: `❌ ${agent} ▸ ${task.name}`,
    body: `${stepLabel}\n${errorLine}`,
    priority: 4,
    tags: ["rotating_light"],
  };
}

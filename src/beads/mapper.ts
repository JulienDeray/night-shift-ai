import type { NightShiftTask } from "../core/types.js";
import type { BeadEntry } from "./types.js";

export function toBeadLabels(task: NightShiftTask): string[] {
  const labels = ["nightshift"];

  if (task.origin === "one-off") {
    labels.push("nightshift:one-off");
  } else if (task.origin === "recurring" && task.recurringName) {
    labels.push(`nightshift:recurring:${task.recurringName}`);
  }

  return labels;
}

export function toBeadDescription(task: NightShiftTask): string {
  const meta = [
    `origin: ${task.origin}`,
    `timeout: ${task.timeout}`,
    task.maxBudgetUsd !== undefined ? `max_budget_usd: ${task.maxBudgetUsd}` : null,
    task.model ? `model: ${task.model}` : null,
    task.allowedTools?.length ? `allowed_tools: ${task.allowedTools.join(", ")}` : null,
    task.output ? `output: ${task.output}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `---nightshift-meta---\n${meta}\n---end-meta---\n\n${task.prompt}`;
}

export function fromBead(bead: BeadEntry): NightShiftTask {
  const meta = parseBeadDescription(bead.description);
  const labels = bead.labels ?? [];
  const origin = labels.some((l) => l.startsWith("nightshift:recurring:"))
    ? "recurring"
    : (meta.origin as "one-off" | "recurring" | undefined) ?? "one-off";
  const recurringLabel = labels.find((l) =>
    l.startsWith("nightshift:recurring:"),
  );
  const recurringName = recurringLabel
    ? recurringLabel.replace("nightshift:recurring:", "")
    : meta.recurringName;

  return {
    id: bead.id,
    name: bead.title,
    origin,
    prompt: meta.prompt,
    status: bead.status === "closed" ? "completed" : "pending",
    allowedTools: meta.allowedTools,
    timeout: meta.timeout ?? "30m",
    maxBudgetUsd: meta.maxBudgetUsd,
    model: meta.model,
    output: meta.output,
    createdAt: bead.created_at,
    recurringName,
  };
}

interface ParsedMeta {
  prompt: string;
  origin?: string;
  timeout?: string;
  maxBudgetUsd?: number;
  model?: string;
  allowedTools?: string[];
  output?: string;
  recurringName?: string;
}

function parseBeadDescription(description: string): ParsedMeta {
  const metaMatch = description.match(
    /---nightshift-meta---\n([\s\S]*?)\n---end-meta---\n\n([\s\S]*)/,
  );
  if (!metaMatch) {
    return { prompt: description };
  }

  const metaLines = metaMatch[1].split("\n");
  const prompt = metaMatch[2];
  const result: ParsedMeta = { prompt };

  for (const line of metaLines) {
    const [key, ...rest] = line.split(": ");
    const value = rest.join(": ").trim();
    switch (key?.trim()) {
      case "origin":
        result.origin = value;
        break;
      case "timeout":
        result.timeout = value;
        break;
      case "max_budget_usd":
        result.maxBudgetUsd = parseFloat(value);
        break;
      case "model":
        result.model = value;
        break;
      case "allowed_tools":
        result.allowedTools = value.split(", ");
        break;
      case "output":
        result.output = value;
        break;
    }
  }

  return result;
}

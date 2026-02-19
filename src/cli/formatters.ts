import chalk from "chalk";
import type { TaskStatus } from "../core/types.js";

export function statusColor(status: TaskStatus | "completed" | "failed" | "timed-out"): string {
  switch (status) {
    case "pending":
      return chalk.gray(status);
    case "ready":
      return chalk.blue(status);
    case "running":
      return chalk.yellow(status);
    case "completed":
      return chalk.green(status);
    case "failed":
      return chalk.red(status);
    case "timed-out":
      return chalk.red(status);
    default:
      return status;
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function table(
  headers: string[],
  rows: string[][],
): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = headers
    .map((h, i) => ` ${h.padEnd(colWidths[i])} `)
    .join("│");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => ` ${cell.padEnd(colWidths[i])} `).join("│"),
  );

  return [headerLine, sep, ...dataLines].join("\n");
}

export function heading(text: string): string {
  return chalk.bold.underline(text);
}

export function success(text: string): string {
  return chalk.green(`✓ ${text}`);
}

export function error(text: string): string {
  return chalk.red(`✗ ${text}`);
}

export function warn(text: string): string {
  return chalk.yellow(`⚠ ${text}`);
}

export function info(text: string): string {
  return chalk.blue(`ℹ ${text}`);
}

export function dim(text: string): string {
  return chalk.dim(text);
}

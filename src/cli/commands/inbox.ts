import { Command } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";
import { getInboxDir } from "../../core/paths.js";
import { loadConfig } from "../../core/config.js";
import { table, heading, statusColor, formatDuration, formatCost, dim, error } from "../formatters.js";
import type { InboxEntry } from "../../core/types.js";

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(": ");
    if (key && rest.length > 0) {
      result[key.trim()] = rest.join(": ").trim();
    }
  }
  return result;
}

export const inboxCommand = new Command("inbox")
  .description("Browse completed task reports")
  .option("-n, --limit <count>", "Number of reports to show", "10")
  .option("--read <file>", "Read a specific report file")
  .action(async (options) => {
    try {
      await loadConfig();
      const inboxDir = getInboxDir();

      if (options.read) {
        const filePath = path.resolve(inboxDir, options.read);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          console.log(content);
        } catch {
          console.error(error(`Report not found: ${options.read}`));
          process.exitCode = 1;
        }
        return;
      }

      let files: string[];
      try {
        files = await fs.readdir(inboxDir);
      } catch {
        console.log(dim("No inbox reports yet."));
        return;
      }

      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, parseInt(options.limit, 10));

      if (mdFiles.length === 0) {
        console.log(dim("No inbox reports yet."));
        return;
      }

      console.log(heading("Inbox"));
      console.log("");

      const rows: string[][] = [];
      for (const file of mdFiles) {
        const content = await fs.readFile(path.join(inboxDir, file), "utf-8");
        const fm = parseFrontmatter(content);
        rows.push([
          fm.task_name ?? "unknown",
          statusColor((fm.status ?? "completed") as InboxEntry["status"]),
          fm.duration_seconds ? formatDuration(parseInt(fm.duration_seconds, 10)) : "?",
          fm.cost_usd ? formatCost(parseFloat(fm.cost_usd)) : "?",
          file,
        ]);
      }

      console.log(table(["Task", "Status", "Duration", "Cost", "File"], rows));
      console.log("");
      console.log(dim(`Run 'nightshift inbox --read <file>' to view a report`));
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

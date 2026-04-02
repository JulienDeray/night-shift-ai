import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { readJsonFile } from "../../utils/fs.js";
import { getQueueDir } from "../../core/paths.js";
import { statusColor, formatCost, heading, dim, error, table } from "../formatters.js";
import { formatDistanceToNow } from "date-fns";
import type { NightShiftTask } from "../../core/types.js";
import type { TaskStatus } from "../../core/types.js";
import fs from "node:fs/promises";
import path from "node:path";

export const statusCommand = new Command("status")
  .description("Show daemon status and task queue")
  .action(async () => {
    try {
      const config = await loadConfig();
      const state = await readDaemonState();
      const daemonUp = state != null && isDaemonRunning(state);

      // Daemon status
      console.log(heading("Daemon"));
      if (daemonUp) {
        console.log(`  Status:    ${statusColor("running")}`);
        console.log(`  PID:       ${state.pid}`);
        console.log(`  Uptime:    ${formatDistanceToNow(new Date(state.startedAt))}`);
        console.log(`  Heartbeat: ${formatDistanceToNow(new Date(state.lastHeartbeat))} ago`);
        console.log(`  Active:    ${state.activeTasks} / ${config.maxConcurrent}`);
        console.log(`  Executed:  ${state.totalExecuted}`);
        console.log(`  Cost:      ${formatCost(state.totalCostUsd)}`);
      } else {
        console.log(`  Status: ${dim("stopped")}`);
      }

      // Queue status
      console.log("");
      console.log(heading("Queue"));

      // Scheduled tasks (from daemon state — these live in-memory, not on disk)
      const scheduledPending = state?.pendingTaskCount ?? 0;
      const scheduledRunning = state?.runningTaskDetails ?? [];

      // File-based queue (from `nightshift submit`)
      let filePending = 0;
      let fileRunning = 0;
      const fileActiveTasks: NightShiftTask[] = [];
      try {
        const queueDir = getQueueDir();
        const files = await fs.readdir(queueDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const task = await readJsonFile<NightShiftTask>(
            path.join(queueDir, file),
          );
          if (task && (task.status === "pending" || task.status === "ready" || task.status === "running")) {
            fileActiveTasks.push(task);
          }
        }
        filePending = fileActiveTasks.filter((t) => t.status === "pending" || t.status === "ready").length;
        fileRunning = fileActiveTasks.filter((t) => t.status === "running").length;
      } catch {
        // queue dir may not exist
      }

      const totalPending = scheduledPending + filePending;
      const totalRunning = scheduledRunning.length + fileRunning;
      console.log(`  Pending: ${totalPending}`);
      console.log(`  Running: ${totalRunning}`);

      // Build unified task list for the table
      const allDisplayTasks: Array<{ id: string; name: string; agentName: string; status: TaskStatus; created: string }> = [];

      // Add running scheduled tasks
      for (const rt of scheduledRunning) {
        allDisplayTasks.push({
          id: rt.id,
          name: rt.name,
          agentName: rt.agentName,
          status: "running" as const,
          created: rt.startedAt,
        });
      }

      // Add file-based tasks
      for (const task of fileActiveTasks) {
        allDisplayTasks.push({
          id: task.id,
          name: task.name,
          agentName: task.agentName ?? "-",
          status: task.status,
          created: task.createdAt,
        });
      }

      if (allDisplayTasks.length > 0) {
        // Sort: running first, then pending, each by created ascending
        allDisplayTasks.sort((a, b) => {
          const aIsRunning = a.status === "running" ? 0 : 1;
          const bIsRunning = b.status === "running" ? 0 : 1;
          if (aIsRunning !== bIsRunning) return aIsRunning - bIsRunning;
          return new Date(a.created).getTime() - new Date(b.created).getTime();
        });

        const rows = allDisplayTasks.map((task) => {
          const name = task.name.length > 30 ? task.name.slice(0, 30) + "..." : task.name;
          const status = statusColor(task.status);
          const created = formatDistanceToNow(new Date(task.created)) + " ago";
          return [task.id, name, task.agentName, status, created];
        });

        console.log("");
        console.log(table(["ID", "Name", "Agent", "Status", "Created"], rows));
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

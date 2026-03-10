import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { BeadsClient } from "../../beads/client.js";
import { readJsonFile } from "../../utils/fs.js";
import { getQueueDir } from "../../core/paths.js";
import { statusColor, formatCost, heading, dim, error, table } from "../formatters.js";
import { formatDistanceToNow } from "date-fns";
import type { NightShiftTask } from "../../core/types.js";
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

      if (config.beads.enabled) {
        try {
          const beads = new BeadsClient();
          const ready = await beads.listReady();
          const running = daemonUp ? state.activeTasks : 0;
          console.log(`  Ready:   ${ready.length}`);
          console.log(`  Running: ${running}`);
        } catch {
          console.log(dim("  (beads not available)"));
        }
      } else {
        // File-based queue
        try {
          const queueDir = getQueueDir();
          const files = await fs.readdir(queueDir);
          const activeTasks: NightShiftTask[] = [];
          for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const task = await readJsonFile<NightShiftTask>(
              path.join(queueDir, file),
            );
            if (task && (task.status === "pending" || task.status === "ready" || task.status === "running")) {
              activeTasks.push(task);
            }
          }
          const pending = activeTasks.filter((t) => t.status === "pending" || t.status === "ready").length;
          const running = activeTasks.filter((t) => t.status === "running").length;
          console.log(`  Pending: ${pending}`);
          console.log(`  Running: ${running}`);

          if (activeTasks.length > 0) {
            // Sort: running first, then pending/ready, each group by createdAt ascending
            activeTasks.sort((a, b) => {
              const aIsRunning = a.status === "running" ? 0 : 1;
              const bIsRunning = b.status === "running" ? 0 : 1;
              if (aIsRunning !== bIsRunning) return aIsRunning - bIsRunning;
              return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            });

            const rows = activeTasks.map((task) => {
              const name = task.name.length > 30 ? task.name.slice(0, 30) + "..." : task.name;
              const agent = task.agentName ?? "-";
              const status = statusColor(task.status);
              const created = formatDistanceToNow(new Date(task.createdAt)) + " ago";
              return [task.id, name, agent, status, created];
            });

            console.log("");
            console.log(table(["ID", "Name", "Agent", "Status", "Created"], rows));
          }
        } catch {
          console.log(`  Pending: 0`);
          console.log(`  Running: 0`);
        }
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { BeadsClient } from "../../beads/client.js";
import { readJsonFile } from "../../utils/fs.js";
import { getQueueDir } from "../../core/paths.js";
import { statusColor, formatCost, heading, dim, error } from "../formatters.js";
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
          let pending = 0;
          for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const task = await readJsonFile<NightShiftTask>(
              path.join(queueDir, file),
            );
            if (task?.status === "pending") pending++;
          }
          const running = daemonUp ? state.activeTasks : 0;
          console.log(`  Pending: ${pending}`);
          console.log(`  Running: ${running}`);
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

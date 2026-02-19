import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { BeadsClient } from "../../beads/client.js";
import { statusColor, formatCost, heading, dim, error } from "../formatters.js";
import { formatDistanceToNow } from "date-fns";

export const statusCommand = new Command("status")
  .description("Show daemon status and task queue")
  .action(async () => {
    try {
      const config = await loadConfig();
      const state = await readDaemonState();

      // Daemon status
      console.log(heading("Daemon"));
      if (state && isDaemonRunning(state)) {
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
          const running = await beads.listByLabel("nightshift:running");
          console.log(`  Ready:   ${ready.length}`);
          console.log(`  Running: ${running.length}`);
        } catch {
          console.log(dim("  (beads not available)"));
        }
      } else {
        console.log(dim("  (beads disabled, using file queue)"));
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

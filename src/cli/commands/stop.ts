import { Command } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import { getDaemonPidPath } from "../../core/paths.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { success, error, warn, info } from "../formatters.js";

export const stopCommand = new Command("stop")
  .description("Stop the night-shift daemon")
  .option("--force", "Force kill the daemon (SIGKILL)")
  .action(async (options) => {
    try {
      const state = await readDaemonState();

      if (!state || !isDaemonRunning(state)) {
        console.log(warn("Daemon is not running"));
        // Clean up stale PID file
        try {
          await fs.unlink(getDaemonPidPath());
        } catch {
          // ignore
        }
        return;
      }

      const signal = options.force ? "SIGKILL" : "SIGTERM";
      console.log(info(`Sending ${signal} to daemon (PID ${state.pid})...`));

      try {
        process.kill(state.pid, signal);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") {
          console.log(warn("Daemon process not found, cleaning up stale state"));
          try {
            await fs.unlink(getDaemonPidPath());
          } catch {
            // ignore
          }
          return;
        }
        throw err;
      }

      if (!options.force) {
        console.log(success("Sent SIGTERM to daemon - it will drain active tasks and exit"));
        console.log(info("Use 'nightshift status' to monitor shutdown"));
        console.log(info("Use 'nightshift stop --force' to kill immediately"));
      } else {
        console.log(success("Daemon killed"));
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

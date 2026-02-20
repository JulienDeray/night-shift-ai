import { Command } from "@commander-js/extra-typings";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../core/config.js";
import { getDaemonPidPath } from "../../core/paths.js";
import { readDaemonState, isDaemonRunning } from "../../daemon/health.js";
import { success, error, warn } from "../formatters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const startCommand = new Command("start")
  .description("Start the night-shift daemon")
  .action(async () => {
    try {
      // Validate config first
      await loadConfig();

      // Check if already running
      const state = await readDaemonState();
      if (state && isDaemonRunning(state)) {
        console.log(warn(`Daemon already running (PID ${state.pid})`));
        return;
      }

      // Spawn daemon as a fully detached process.
      // Using spawn instead of fork avoids the implicit IPC channel
      // that fork creates, which would keep the parent process alive.
      const daemonPath = path.resolve(__dirname, "../../daemon/index.js");
      const child = spawn(process.execPath, [daemonPath], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      });

      child.unref();

      const pid = child.pid;
      if (!pid) {
        console.error(error("Failed to start daemon: no PID returned"));
        process.exitCode = 1;
        return;
      }

      console.log(success(`Daemon started (PID ${pid})`));
      console.log(`  PID file: ${getDaemonPidPath()}`);
      console.log(`  Run 'nightshift status' to check daemon status`);
      console.log(`  Run 'nightshift stop' to stop the daemon`);
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { error } from "../formatters.js";
import { runAgentForeground, generateTaskId } from "./_run-agent.js";

export const runCommand = new Command("run")
  .description("Run an agent in the foreground")
  .option("-a, --agent <name>", "Agent name to run (required)")
  .option("--var <keyvalue...>", "Variable overrides as key=value pairs")
  .option("-n, --name <name>", "Task name")
  .option("-N, --notify", "Send ntfy notifications on start/end")
  .action(async (options) => {
    try {
      if (!options.agent) {
        console.error(error("Error: --agent <name> is required"));
        process.exitCode = 1;
        return;
      }

      const config = await loadConfig();

      // Parse --var key=value pairs into a Record
      const vars: Record<string, string> = {};
      if (options.var) {
        for (const kv of options.var) {
          const eqIdx = kv.indexOf("=");
          if (eqIdx === -1) {
            console.error(error(`Invalid --var format (expected key=value): ${kv}`));
            process.exitCode = 1;
            return;
          }
          const k = kv.slice(0, eqIdx);
          const v = kv.slice(eqIdx + 1);
          vars[k] = v;
        }
      }

      const taskId = generateTaskId();
      const taskName = options.name ?? `${options.agent}-${taskId}`;

      await runAgentForeground({
        agentName: options.agent,
        taskId,
        taskName,
        vars,
        notify: options.notify,
        ntfyConfig: config.ntfy,
      });
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

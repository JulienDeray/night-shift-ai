import { Command } from "@commander-js/extra-typings";
import { loadConfig } from "../../core/config.js";
import { writeJsonFile } from "../../utils/fs.js";
import { getQueueDir } from "../../core/paths.js";
import { success, error, info } from "../formatters.js";
import path from "node:path";
import type { NightShiftTask } from "../../core/types.js";
import { runAgentForeground, generateTaskId } from "./_run-agent.js";

export const submitCommand = new Command("submit")
  .description("Submit a one-off task for the daemon to execute")
  .argument("[prompt]", "Optional task prompt override", "")
  .option("-a, --agent <name>", "Agent name to use (required)")
  .option("-t, --timeout <timeout>", "Task timeout (e.g. 30m, 1h)")
  .option("-n, --name <name>", "Task name")
  .option("--var <keyvalue...>", "Variable overrides as key=value pairs")
  .option("-s, --sync", "Queue the task and immediately execute the agent synchronously")
  .action(async (prompt, options) => {
    try {
      if (!options.agent) {
        console.error(error("Error: --agent <name> is required"));
        process.exitCode = 1;
        return;
      }

      const config = await loadConfig();
      const taskId = generateTaskId();
      const taskName = options.name ?? `${options.agent}-${taskId}`;

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
          vars[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
        }
      }

      // Merge agent-level config variables with CLI --var overrides (CLI wins)
      const agentDecl = config.agents.find((a) => a.name === options.agent);
      const mergedVars = { ...(agentDecl?.variables ?? {}), ...vars };

      const task: NightShiftTask = {
        id: taskId,
        name: taskName,
        origin: "one-off",
        prompt,
        status: "pending",
        timeout: options.timeout ?? config.oneOffDefaults.timeout,
        createdAt: new Date().toISOString(),
        agentName: options.agent,
        ...(agentDecl?.notify !== undefined && { notify: agentDecl.notify }),
        ...(Object.keys(mergedVars).length > 0 && { variables: mergedVars }),
      };

      const queuePath = path.join(getQueueDir(), `${taskId}.json`);
      await writeJsonFile(queuePath, task);
      console.log(success(`Task queued: ${taskId}`));

      console.log(info(`Agent:   ${options.agent}`));
      if (prompt) {
        console.log(info(`Prompt:  "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`));
      }
      console.log(info(`Timeout: ${task.timeout}`));

      if (options.sync) {
        await runAgentForeground({
          agentName: options.agent,
          taskId: task.id,
          taskName,
          vars,
          ntfyConfig: config.ntfy,
        });
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

import { Command } from "@commander-js/extra-typings";
import crypto from "node:crypto";
import { loadConfig } from "../../core/config.js";
import { BeadsClient } from "../../beads/client.js";
import { toBeadLabels, toBeadDescription } from "../../beads/mapper.js";
import { writeJsonFile } from "../../utils/fs.js";
import { getQueueDir } from "../../core/paths.js";
import { success, error, info } from "../formatters.js";
import path from "node:path";
import type { NightShiftTask } from "../../core/types.js";

export const submitCommand = new Command("submit")
  .description("Submit a one-off task for the daemon to execute")
  .argument("<prompt>", "The task prompt for the AI agent")
  .option("-t, --timeout <timeout>", "Task timeout (e.g. 30m, 1h)")
  .option("-b, --budget <usd>", "Max budget in USD", parseFloat)
  .option("-m, --model <model>", "Model to use (e.g. sonnet, opus)")
  .option("--tools <tools...>", "Allowed tools for the agent")
  .option("-n, --name <name>", "Task name")
  .action(async (prompt, options) => {
    try {
      const config = await loadConfig();
      const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
      const taskName = options.name ?? `one-off-${taskId}`;

      const task: NightShiftTask = {
        id: taskId,
        name: taskName,
        origin: "one-off",
        prompt,
        status: "pending",
        allowedTools: options.tools,
        timeout: options.timeout ?? config.oneOffDefaults.timeout,
        maxBudgetUsd: options.budget ?? config.oneOffDefaults.maxBudgetUsd,
        model: options.model ?? config.oneOffDefaults.model,
        createdAt: new Date().toISOString(),
      };

      if (config.beads.enabled) {
        const beads = new BeadsClient();
        const beadId = await beads.create({
          title: taskName,
          description: toBeadDescription(task),
          labels: toBeadLabels(task),
        });
        task.id = beadId;
        console.log(success(`Task submitted as bead ${beadId}`));
      } else {
        const queuePath = path.join(getQueueDir(), `${taskId}.json`);
        await writeJsonFile(queuePath, task);
        console.log(success(`Task queued: ${taskId}`));
      }

      console.log(info(`Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`));
      console.log(info(`Timeout: ${task.timeout} | Budget: $${task.maxBudgetUsd?.toFixed(2) ?? "unlimited"}`));
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

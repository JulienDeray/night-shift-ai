import { Command } from "@commander-js/extra-typings";
import crypto from "node:crypto";
import { loadConfig } from "../../core/config.js";
import { getWorkspaceDir } from "../../core/paths.js";
import { Logger } from "../../core/logger.js";
import { AgentRunner } from "../../daemon/agent-runner.js";
import { NtfyClient } from "../../notifications/ntfy-client.js";
import { success, error, info, formatDuration, formatCost } from "../formatters.js";
import type { NightShiftTask } from "../../core/types.js";

export const runCommand = new Command("run")
  .description("Execute a task immediately as a one-off foreground process")
  .argument("<prompt>", "The task prompt for the AI agent")
  .option("-t, --timeout <timeout>", "Task timeout (e.g. 30m, 1h)")
  .option("-b, --budget <usd>", "Max budget in USD", parseFloat)
  .option("-m, --model <model>", "Model to use (e.g. sonnet, opus)")
  .option("--tools <tools...>", "Allowed tools for the agent")
  .option("-n, --name <name>", "Task name")
  .option("-N, --notify", "Send ntfy notifications on start/end")
  .action(async (prompt, options) => {
    try {
      const config = await loadConfig();
      const logger = Logger.createCliLogger(true);

      if (!prompt) {
        console.error(error("A <prompt> argument is required"));
        process.exitCode = 1;
        return;
      }

      // Set up ntfy client if --notify is requested
      const ntfy =
        options.notify && config.ntfy ? new NtfyClient(config.ntfy) : null;

      // Generic task mode
      const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
      const taskName = options.name ?? `one-off-${taskId}`;

      const task: NightShiftTask = {
        id: taskId,
        name: taskName,
        origin: "one-off",
        prompt: prompt,
        status: "pending",
        allowedTools: options.tools,
        timeout: options.timeout ?? config.oneOffDefaults.timeout,
        maxBudgetUsd: options.budget ?? config.oneOffDefaults.maxBudgetUsd,
        model: options.model ?? config.oneOffDefaults.model,
        createdAt: new Date().toISOString(),
      };

      const workspaceDir = getWorkspaceDir(config.workspace);

      const runner = new AgentRunner({ workspaceDir, logger });

      if (ntfy) {
        await ntfy.send(
          {
            title: `Night-shift started: ${task.name}`,
            body: "Running\u2026",
            priority: 3,
          },
          logger,
        );
      }

      console.log(info(`Running task: ${task.name}`));
      console.log(
        info(
          `Prompt: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}"`,
        ),
      );

      const result = await runner.run(task);
      const durationSec = Math.round(result.durationMs / 1000);

      console.log();
      if (result.isError) {
        console.log(error("Task failed"));
      } else {
        console.log(success("Task completed"));
      }
      console.log(info(`Name:     ${task.name}`));
      console.log(info(`Duration: ${formatDuration(durationSec)}`));
      console.log(info(`Cost:     ${formatCost(result.totalCostUsd)}`));
      console.log(
        info(
          `Result:   ${result.result.slice(0, 200)}${result.result.length > 200 ? "..." : ""}`,
        ),
      );

      if (ntfy) {
        await ntfy.send(
          {
            title: result.isError
              ? `Night-shift FAILED: ${task.name}`
              : `Night-shift done: ${task.name}`,
            body: result.isError
              ? `Error: ${result.result.slice(0, 200)}`
              : `Cost: ${formatCost(result.totalCostUsd)} \u2014 ${result.result.slice(0, 200)}`,
            priority: result.isError ? 4 : 3,
          },
          logger,
        );
      }

      if (result.isError) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

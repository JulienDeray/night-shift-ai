import { Command } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";
import { getQueueDir } from "../../core/paths.js";
import { success, error } from "../formatters.js";
import type { NightShiftTask } from "../../core/types.js";

export const cancelCommand = new Command("cancel")
  .description("Cancel a pending task by ID, removing it from the queue")
  .argument("<task-id>", "The task ID to cancel")
  .action(async (taskId) => {
    try {
      // File-based queue mode
      const queueDir = getQueueDir();
      const taskFilePath = path.join(queueDir, `${taskId}.json`);

      let taskData: string;
      try {
        taskData = await fs.readFile(taskFilePath, "utf-8");
      } catch {
        console.error(error(`Task not found: ${taskId} does not exist in the queue`));
        process.exitCode = 1;
        return;
      }

      const task: NightShiftTask = JSON.parse(taskData);

      if (task.status === "running") {
        console.error(
          error(
            `Cannot cancel task ${taskId}: task is already running`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      if (task.status !== "pending" && task.status !== "ready") {
        console.error(
          error(
            `Cannot cancel task ${taskId}: task status is "${task.status}" (only pending tasks can be cancelled)`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      await fs.unlink(taskFilePath);
      console.log(success(`Cancelled task: ${task.name} (${taskId})`));
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

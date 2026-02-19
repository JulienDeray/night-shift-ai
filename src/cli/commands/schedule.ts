import { Command } from "@commander-js/extra-typings";
import { Cron } from "croner";
import { loadConfig } from "../../core/config.js";
import { table, heading, dim, error } from "../formatters.js";

export const scheduleCommand = new Command("schedule")
  .description("Show recurring tasks and their next run times")
  .action(async () => {
    try {
      const config = await loadConfig();

      console.log(heading("Recurring Tasks"));
      console.log("");

      if (config.recurring.length === 0) {
        console.log(dim("  No recurring tasks configured."));
        console.log(dim("  Edit nightshift.yaml to add recurring tasks."));
        return;
      }

      const rows = config.recurring.map((task) => {
        const cron = new Cron(task.schedule);
        const nextRun = cron.nextRun();
        const nextRunStr = nextRun ? nextRun.toLocaleString() : "N/A";
        const timeout = task.timeout ?? config.defaultTimeout;
        const budget = task.maxBudgetUsd
          ? `$${task.maxBudgetUsd.toFixed(2)}`
          : "default";

        return [task.name, task.schedule, nextRunStr, timeout, budget];
      });

      console.log(
        table(
          ["Name", "Schedule", "Next Run", "Timeout", "Budget"],
          rows,
        ),
      );
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

import { Command } from "@commander-js/extra-typings";
import { Cron } from "croner";
import { loadConfig } from "../../core/config.js";
import { table, heading, dim, error } from "../formatters.js";

export const scheduleCommand = new Command("schedule")
  .description("Show schedule entries and their next run times")
  .action(async () => {
    try {
      const config = await loadConfig();

      console.log(heading("Schedule Entries"));
      console.log("");

      if (config.schedule.length === 0) {
        console.log(dim("  No schedule entries configured."));
        console.log(dim("  Edit nightshift.yaml to add agents and schedule entries."));
        return;
      }

      const rows = config.schedule.map((entry) => {
        const nextRunStr = entry.enabled
          ? (() => {
              const nextRun = new Cron(entry.cron).nextRun();
              return nextRun ? nextRun.toLocaleString() : "N/A";
            })()
          : "disabled";

        return [
          entry.agent,
          entry.cron,
          entry.enabled ? "yes" : "no",
          entry.notify ? "yes" : "-",
          nextRunStr,
        ];
      });

      console.log(
        table(
          ["Name", "Schedule", "Enabled", "Notify", "Next Run"],
          rows,
        ),
      );
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

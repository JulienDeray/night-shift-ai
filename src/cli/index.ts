import { Command } from "@commander-js/extra-typings";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";
import { scheduleCommand } from "./commands/schedule.js";
import { statusCommand } from "./commands/status.js";
import { inboxCommand } from "./commands/inbox.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { configCommand } from "./commands/config.js";

export const program = new Command()
  .name("nightshift")
  .description("Queue tasks for autonomous AI agent execution during off-hours")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(submitCommand);
program.addCommand(scheduleCommand);
program.addCommand(statusCommand);
program.addCommand(inboxCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(configCommand);

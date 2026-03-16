import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Command } from "@commander-js/extra-typings";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";
import { cancelCommand } from "./commands/cancel.js";
import { runCommand } from "./commands/run.js";
import { scheduleCommand } from "./commands/schedule.js";
import { statusCommand } from "./commands/status.js";
import { inboxCommand } from "./commands/inbox.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { configCommand } from "./commands/config.js";
import { agentCommand } from "./commands/agent.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled output is at dist/src/cli/ (3 levels from root), source is at src/cli/ (2 levels from root)
const levelsUp = __dirname.includes(`${path.sep}dist${path.sep}`) ? 3 : 2;
const pkgPath = path.resolve(__dirname, "../".repeat(levelsUp), "package.json");
const { version } = require(pkgPath) as { version: string };

export const program = new Command()
  .name("nightshift")
  .description("Queue tasks for autonomous AI agent execution during off-hours")
  .version(version);

program.addCommand(initCommand);
program.addCommand(submitCommand);
program.addCommand(cancelCommand);
program.addCommand(runCommand);
program.addCommand(scheduleCommand);
program.addCommand(statusCommand);
program.addCommand(inboxCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(configCommand);
program.addCommand(agentCommand);

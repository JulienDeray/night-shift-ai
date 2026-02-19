import { Command } from "@commander-js/extra-typings";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig, validateConfig } from "../../core/config.js";
import { success, error } from "../formatters.js";

export const configCommand = new Command("config")
  .description("View or validate configuration");

configCommand
  .command("show")
  .description("Show resolved configuration")
  .action(async () => {
    try {
      const config = await loadConfig();
      console.log(stringifyYaml(config));
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

configCommand
  .command("validate")
  .description("Validate nightshift.yaml")
  .action(async () => {
    const result = await validateConfig();
    if (result.valid) {
      console.log(success("Configuration is valid"));
    } else {
      console.error(error("Configuration is invalid:"));
      console.error(result.error);
      process.exitCode = 1;
    }
  });

import fs from "node:fs/promises";
import { Command } from "@commander-js/extra-typings";
import { getConfigPath, ensureNightShiftDirs, getWorkspaceDir, ensureDir } from "../../core/paths.js";
import { getDefaultConfigYaml } from "../../core/config.js";
import { fileExists } from "../../utils/fs.js";
import { success, warn, info } from "../formatters.js";

export const initCommand = new Command("init")
  .description("Initialize night-shift in the current directory")
  .option("--force", "Overwrite existing config")
  .action(async (options) => {
    const configPath = getConfigPath();
    const configExists = await fileExists(configPath);

    if (configExists && !options.force) {
      console.log(warn("nightshift.yaml already exists. Use --force to overwrite."));
      return;
    }

    // Create directory structure
    await ensureNightShiftDirs();
    await ensureDir(getWorkspaceDir("./workspace"));

    // Write default config
    await fs.writeFile(configPath, getDefaultConfigYaml(), "utf-8");

    console.log(success("Initialized night-shift"));
    console.log(info("Created .nightshift/ directory structure"));
    console.log(info("Created nightshift.yaml with default config"));
    console.log("");
    console.log("Next steps:");
    console.log("  1. Edit nightshift.yaml to configure recurring tasks");
    console.log("  2. Run 'nightshift submit \"<task>\"' to queue a one-off task");
    console.log("  3. Run 'nightshift start' to start the daemon");
  });

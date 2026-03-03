import { Command } from "@commander-js/extra-typings";
import crypto from "node:crypto";
import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { Logger } from "../../core/logger.js";
import { AgentEngine } from "../../agent/engine.js";
import { BeadRegistry } from "../../agent/bead-registry.js";
import { StandardBeadPlugin } from "../../agent/plugins/standard-bead-plugin.js";
import { GitCloneBeadPlugin } from "../../agent/plugins/git-clone-bead-plugin.js";
import { NtfyClient } from "../../notifications/ntfy-client.js";
import { success, error, info, formatDuration } from "../formatters.js";

export const runCommand = new Command("run")
  .description("Run an agent in the foreground")
  .option("-a, --agent <name>", "Agent name to run (required)")
  .option("--var <keyvalue...>", "Variable overrides as key=value pairs")
  .option("-n, --name <name>", "Task name")
  .option("-N, --notify", "Send ntfy notifications on start/end")
  .action(async (options) => {
    try {
      if (!options.agent) {
        console.error(error("Error: --agent <name> is required"));
        process.exitCode = 1;
        return;
      }

      const config = await loadConfig();
      const logger = Logger.createCliLogger(true);

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
          const k = kv.slice(0, eqIdx);
          const v = kv.slice(eqIdx + 1);
          vars[k] = v;
        }
      }

      const taskId = `ns-${crypto.randomBytes(4).toString("hex")}`;
      const taskName = options.name ?? `${options.agent}-${taskId}`;

      // Set up ntfy client if --notify is requested
      const ntfy =
        options.notify && config.ntfy ? new NtfyClient(config.ntfy) : null;

      if (ntfy) {
        await ntfy.send(
          {
            title: `Night-shift started: ${taskName}`,
            body: "Running\u2026",
            priority: 3,
          },
          logger,
        );
      }

      console.log(info(`Running agent: ${options.agent}`));
      console.log(info(`Task ID: ${taskId}`));

      // Build agent paths
      const configDir = process.cwd();
      const agentsRoot = path.resolve(configDir, config.agentsDir);
      const agentDir = path.join(agentsRoot, options.agent);

      // Create registry and engine
      const registry = new BeadRegistry();
      registry.register("standard", (_bead, _manifest) => new StandardBeadPlugin());
      registry.register("git-clone", (_bead, _manifest) => new GitCloneBeadPlugin());

      const engine = new AgentEngine(registry, logger);

      const result = await engine.run(agentDir, agentsRoot, taskId, Object.keys(vars).length > 0 ? vars : undefined);

      const durationSec = Math.round(result.totalDurationMs / 1000);

      console.log();

      // Per-bead summary
      for (const bead of result.perBead) {
        const beadDuration = Math.round(bead.durationMs / 1000);
        const beadStatus = bead.status === "SUCCESS" ? success : bead.status === "FAILED" ? error : info;
        console.log(beadStatus(`  [${bead.name}] ${bead.status} (${formatDuration(beadDuration)})`));
        if (bead.error) {
          console.log(error(`    Error: ${bead.error.slice(0, 200)}`));
        }
      }

      console.log();

      if (result.status === "SUCCESS") {
        console.log(success("Agent run completed successfully"));
      } else {
        console.log(error(`Agent run ${result.status}`));
        if (result.error) {
          console.log(error(`Error: ${result.error.slice(0, 200)}`));
        }
      }

      console.log(info(`Agent:    ${options.agent}`));
      console.log(info(`Duration: ${formatDuration(durationSec)}`));

      if (result.finalOutput) {
        const outputStr = typeof result.finalOutput === "string"
          ? result.finalOutput
          : JSON.stringify(result.finalOutput);
        console.log(
          info(`Result:   ${outputStr.slice(0, 200)}${outputStr.length > 200 ? "..." : ""}`),
        );
      }

      if (ntfy) {
        await ntfy.send(
          {
            title: result.status === "SUCCESS"
              ? `Night-shift done: ${taskName}`
              : `Night-shift FAILED: ${taskName}`,
            body: result.status === "SUCCESS"
              ? `Duration: ${formatDuration(durationSec)}`
              : `Error: ${result.error?.slice(0, 200) ?? result.status}`,
            priority: result.status === "SUCCESS" ? 3 : 4,
          },
          logger,
        );
      }

      if (result.status !== "SUCCESS") {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(error(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

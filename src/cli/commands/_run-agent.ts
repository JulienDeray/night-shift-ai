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
import type { AgentRunResult } from "../../agent/engine-types.js";
import type { NtfyConfig } from "../../core/types.js";

export interface RunAgentForegroundOptions {
  agentName: string;
  taskId: string;
  taskName: string;
  vars?: Record<string, string>;
  notify?: boolean;
  ntfyConfig?: NtfyConfig;
}

/**
 * Runs an agent in the foreground, streaming per-bead progress and a final
 * summary to the terminal. Used by both `run` and `submit --sync`.
 *
 * Sets `process.exitCode = 1` if the agent does not complete with SUCCESS.
 * Throws if the agent directory cannot be resolved or the engine fails to load.
 */
export async function runAgentForeground(
  options: RunAgentForegroundOptions,
): Promise<AgentRunResult> {
  const { agentName, taskId, taskName, vars = {}, notify = false, ntfyConfig } = options;

  const config = await loadConfig();
  const logger = Logger.createCliLogger(true);

  // Set up ntfy client if --notify is requested
  const ntfy = notify && ntfyConfig ? new NtfyClient(ntfyConfig) : null;

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

  console.log(info(`Running agent: ${agentName}`));
  console.log(info(`Task ID: ${taskId}`));

  // Build agent paths
  const configDir = process.cwd();
  const agentsRoot = path.resolve(configDir, config.agentsDir);
  const agentDir = path.join(agentsRoot, agentName);

  // Create registry and engine
  const registry = new BeadRegistry();
  registry.register("standard", (_bead, _manifest) => new StandardBeadPlugin());
  registry.register("git-clone", (_bead, _manifest) => new GitCloneBeadPlugin());

  const engine = new AgentEngine(registry, logger);

  const result = await engine.run(
    agentDir,
    agentsRoot,
    taskId,
    Object.keys(vars).length > 0 ? vars : undefined,
  );

  const durationSec = Math.round(result.totalDurationMs / 1000);

  console.log();

  // Per-bead summary
  for (const bead of result.perBead) {
    const beadDuration = Math.round(bead.durationMs / 1000);
    const beadStatusFn =
      bead.status === "SUCCESS" ? success : bead.status === "FAILED" ? error : info;
    console.log(beadStatusFn(`  [${bead.name}] ${bead.status} (${formatDuration(beadDuration)})`));
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

  console.log(info(`Agent:    ${agentName}`));
  console.log(info(`Duration: ${formatDuration(durationSec)}`));

  if (result.finalOutput) {
    const outputStr =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : JSON.stringify(result.finalOutput);
    console.log(
      info(`Result:   ${outputStr.slice(0, 200)}${outputStr.length > 200 ? "..." : ""}`),
    );
  }

  if (ntfy) {
    await ntfy.send(
      {
        title:
          result.status === "SUCCESS"
            ? `Night-shift done: ${taskName}`
            : `Night-shift FAILED: ${taskName}`,
        body:
          result.status === "SUCCESS"
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

  return result;
}

/**
 * Generates a random task ID with the ns- prefix.
 */
export function generateTaskId(): string {
  return `ns-${crypto.randomBytes(4).toString("hex")}`;
}

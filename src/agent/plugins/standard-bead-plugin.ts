import fs from "node:fs/promises";
import path from "node:path";
import { runBead } from "../bead-runner.js";
import { renderAgentTemplate } from "../template.js";
import { parseTimeout } from "../../utils/process.js";
import type { BeadPlugin, AgentPipelineContext, BeadOutput } from "../bead-plugin.js";

/**
 * Standard bead plugin — maps AgentPipelineContext to runBead() parameters
 * and returns BeadOutput.
 *
 * This is a thin wrapper. It does NOT call validateBeadOutput() — output
 * validation is the engine's responsibility (Plan 02).
 */
export class StandardBeadPlugin implements BeadPlugin {
  async execute(ctx: AgentPipelineContext): Promise<BeadOutput> {
    // 1. Read prompt file from agent directory
    const rawPrompt = await fs.readFile(
      path.join(ctx.agentDir, ctx.currentBead.prompt),
      "utf-8",
    );

    // 2. Render template with resolved variables
    const renderedPrompt = renderAgentTemplate(rawPrompt, ctx.variables);

    // 3. Parse timeout from bead config
    const timeoutMs = parseTimeout(ctx.currentBead.timeout);

    // 4. Resolve GITLAB_TOKEN from resolved env entries (if present)
    const gitlabTokenEntry = ctx.currentBead.env.find(
      (e) => e.name === "GITLAB_TOKEN",
    );
    const gitlabToken = gitlabTokenEntry?.value;

    // 5. Call runBead with the mapped parameters
    const result = await runBead({
      beadName: ctx.currentBead.name,
      prompt: renderedPrompt,
      model: ctx.currentBead.model,
      cwd: ctx.workDir,
      timeoutMs,
      gitlabToken,
      allowedTools: ctx.currentBead.allowedTools,
    });

    // 6. Handle errors — non-zero exit or timeout both throw
    if (result.timedOut) {
      throw new Error(
        `Bead "${ctx.currentBead.name}" timed out after ${timeoutMs}ms`,
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Bead "${ctx.currentBead.name}" failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // 7. Return raw output — engine handles validation
    return { rawOutput: result.stdout };
  }
}

import { cloneRepo } from "../git-harness.js";
import type { BeadPlugin, AgentPipelineContext, BeadOutput } from "../bead-plugin.js";

/**
 * Git clone bead plugin — maps AgentPipelineContext to cloneRepo() and
 * returns the clone paths as JSON in rawOutput.
 *
 * Uses ctx.workDir as the pre-created repo directory (TempDirManager creates
 * this as {runTmpDir}/repo/ before the engine starts the pipeline).
 *
 * The engine will parse rawOutput to update ctx.workDir for subsequent beads.
 */
export class GitCloneBeadPlugin implements BeadPlugin {
  async execute(ctx: AgentPipelineContext): Promise<BeadOutput> {
    // 1. Extract repo_url from resolved variables — required
    const repoUrl = ctx.variables["repo_url"];
    if (!repoUrl || typeof repoUrl !== "string") {
      throw new Error(
        "GitCloneBeadPlugin requires 'repo_url' variable",
      );
    }

    // 2. Resolve GITLAB_TOKEN from resolved env entries (if present)
    const gitlabTokenEntry = ctx.currentBead.env.find(
      (e) => e.name === "GITLAB_TOKEN",
    );
    const gitlabToken = gitlabTokenEntry?.value;

    // 3. Use ctx.workDir as the pre-created repo directory
    const repoDir = ctx.workDir;

    // 4. Clone into the engine-managed directory
    const cloneResult = await cloneRepo(repoUrl, gitlabToken, repoDir);

    // 5. Return clone paths as JSON code block — validateBeadOutput extracts last JSON code block
    const payload = JSON.stringify({
      repoDir: cloneResult.repoDir,
      handoffDir: cloneResult.handoffDir,
    });
    return {
      rawOutput: "```json\n" + payload + "\n```",
    };
  }
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../core/logger.js";
import type { BeadErrorCategory, AgentRunResult, BeadOutcome } from "./engine-types.js";
import type { AgentPipelineContext } from "./bead-plugin.js";
import { BeadRegistry } from "./bead-registry.js";
import { TempDirManager } from "./temp-dir-manager.js";
import { loadManifest, validateBeadOutput } from "./manifest-loader.js";
import {
  buildBuiltIns,
  buildTemplateVars,
  validateTemplateVars,
  renderAgentTemplate,
} from "./template.js";
import {
  ManifestError,
  ManifestSecurityError,
  BeadContractViolationError,
  BeadOutputMissingError,
  RegistryError,
} from "../core/errors.js";
import { spawnWithTimeout } from "../utils/process.js";

// ---------------------------------------------------------------------------
// Error categorization
// ---------------------------------------------------------------------------

/**
 * Classifies a bead execution error as FATAL or TRANSIENT.
 *
 * Rules (per locked CONTEXT.md):
 * - timedOut=true        → FATAL (timeout is a hard stop)
 * - BeadOutputMissingError → TRANSIENT (Claude might produce JSON on retry)
 * - BeadContractViolationError → TRANSIENT (schema mismatch might resolve on retry)
 * - ManifestSecurityError → FATAL (path traversal is structural)
 * - ManifestError         → FATAL (bad manifest is structural)
 * - RegistryError         → FATAL (unknown bead type is structural)
 * - Default               → FATAL (safe default for unknown errors)
 */
function categorizeError(err: unknown, timedOut: boolean): BeadErrorCategory {
  if (timedOut) return "FATAL";
  if (err instanceof BeadOutputMissingError) return "TRANSIENT";
  if (err instanceof BeadContractViolationError) return "TRANSIENT";
  if (err instanceof ManifestSecurityError) return "FATAL";
  if (err instanceof ManifestError) return "FATAL";
  if (err instanceof RegistryError) return "FATAL";
  // Check for timeout indicators in error message
  if (err instanceof Error && err.message.toLowerCase().includes("timed out")) return "FATAL";
  return "FATAL";
}

// ---------------------------------------------------------------------------
// AgentEngine
// ---------------------------------------------------------------------------

/**
 * Generic pipeline orchestrator. Drives any agent directory through its
 * bead pipeline without containing any agent-specific logic.
 *
 * Responsibilities:
 * 1. Load manifest from agent directory
 * 2. Create isolated temp directory for the run
 * 3. Iterate beads: resolve plugin, execute, validate output, accumulate context
 * 4. Handle errors: categorize, rollback temp dir, mark remaining beads SKIPPED
 * 5. Clean up temp dir on both success and failure
 * 6. Return typed AgentRunResult<T>
 */
export class AgentEngine {
  constructor(
    private readonly registry: BeadRegistry,
    private readonly logger: Logger,
  ) {}

  /**
   * Resets the working directory to HEAD via git reset --hard.
   * Called before each retry of the retryFrom bead.
   */
  private async resetWorkDir(workDir: string): Promise<void> {
    const { result } = spawnWithTimeout("git", ["reset", "--hard", "HEAD"], {
      cwd: workDir,
    });
    await result;
  }

  /**
   * Executes a complete agent pipeline.
   *
   * @param agentDir - Path to the agent directory (contains manifest.yaml)
   * @param agentsRoot - Root directory containing all agent directories (for path containment)
   * @param taskId - Unique task identifier threaded through all beads
   * @param configOverrides - Optional runtime config overrides for template variables
   */
  async run<T = unknown>(
    agentDir: string,
    agentsRoot: string,
    taskId: string,
    configOverrides?: Record<string, string>,
  ): Promise<AgentRunResult<T>> {
    const runId = crypto.randomUUID();
    const startTime = Date.now();

    // Create temp dir before loading manifest so we always have a dir to clean up
    const tmpDirManager = new TempDirManager(this.logger);
    const { tmpDir, repoDir, handoffDir } = await tmpDirManager.create(runId);

    // Load manifest — if this throws, cleanup and return FATAL
    let manifest;
    try {
      manifest = await loadManifest(agentDir, agentsRoot);
    } catch (err) {
      await tmpDirManager.cleanup(tmpDir);
      const category: BeadErrorCategory = "FATAL";
      const totalDurationMs = Date.now() - startTime;
      this.logger.error("Engine run failed: manifest load error", {
        runId,
        agentDir,
        error: String(err).slice(0, 500),
      });
      return {
        runId,
        agentName: path.basename(agentDir),
        status: category,
        finalOutput: null,
        perBead: [],
        totalDurationMs,
        errorCategory: category,
        error: String(err),
      };
    }

    // Build initial variables
    const builtIns = buildBuiltIns(taskId, manifest.name, repoDir);
    const initialVars = buildTemplateVars(builtIns, manifest.variables, configOverrides ?? {}, {});

    // Build initial context
    let ctx: AgentPipelineContext = {
      taskId,
      agentName: manifest.name,
      agentDir: manifest.agentDir,
      workDir: repoDir,
      handoffDir,
      manifest,
      currentBead: manifest.beads[0],
      previousBeads: {},
      variables: initialVars,
    };

    const perBead: BeadOutcome[] = [];
    const beadOutputs: Record<string, unknown> = {};

    // Retry state — persists across entire run
    let retryCount = 0;

    // Bead execution loop (while-based to support retry jumps)
    let i = 0;
    while (i < manifest.beads.length) {
      const bead = manifest.beads[i];
      ctx = { ...ctx, currentBead: bead };
      const beadStart = Date.now();

      this.logger.info("Bead started", {
        runId,
        bead: bead.name,
        type: bead.type,
        index: i,
      });

      let rawOutput: string;
      let timedOut = false;

      try {
        // Resolve and execute the bead plugin
        const factory = this.registry.resolve(bead.type);
        const plugin = factory(bead, manifest);
        const output = await plugin.execute(ctx);
        rawOutput = output.rawOutput;

        // Validate bead output against declared schema
        // If this throws (BeadContractViolationError or BeadOutputMissingError),
        // it falls through to the catch block below and is treated as a bead failure.
        const parsed = validateBeadOutput(rawOutput, bead.compiledOutputSchema, bead.name);

        const durationMs = Date.now() - beadStart;

        // Store bead output for caller inspection
        beadOutputs[bead.name] = parsed;

        // Accumulate context for downstream beads
        ctx = {
          ...ctx,
          previousBeads: {
            ...ctx.previousBeads,
            [bead.name]: { output: parsed, rawOutput },
          },
        };

        // Rebuild variables with updated bead outputs
        ctx = {
          ...ctx,
          variables: buildTemplateVars(
            builtIns,
            manifest.variables,
            configOverrides ?? {},
            ctx.previousBeads,
          ),
        };

        perBead.push({ name: bead.name, status: "SUCCESS", durationMs });

        // Check retry trigger: if bead has retry config and output has passed === false
        if (
          bead.retry &&
          typeof parsed === "object" &&
          parsed !== null &&
          "passed" in parsed &&
          (parsed as Record<string, unknown>).passed === false
        ) {
          retryCount++;
          if (retryCount <= bead.retry.maxAttempts) {
            const retryFromIndex = manifest.beads.findIndex((b) => b.name === bead.retry!.retryFrom);

            this.logger.info("Bead triggered retry", {
              runId,
              bead: bead.name,
              retryFrom: bead.retry.retryFrom,
              attempt: retryCount,
              maxAttempts: bead.retry.maxAttempts,
            });

            // Inject retry_error into variables for the retryFrom bead
            const errorDetails = (parsed as Record<string, unknown>).error_details ?? "";
            ctx = {
              ...ctx,
              variables: {
                ...ctx.variables,
                retry_error: String(errorDetails),
              },
            };

            // Reset working directory before retry
            await this.resetWorkDir(ctx.workDir);

            // Jump back to retryFrom bead
            i = retryFromIndex;
            continue;
          }
          // Max retries exhausted — log and fall through to normal progression
          this.logger.warn("Retry exhausted", {
            runId,
            bead: bead.name,
            retryCount,
            maxAttempts: bead.retry.maxAttempts,
          });
        }

        this.logger.info("Bead completed", {
          runId,
          bead: bead.name,
          durationMs,
          outputPreview: rawOutput.slice(0, 200),
        });
      } catch (err) {
        const durationMs = Date.now() - beadStart;

        // Check if this was a timeout error
        if (
          err instanceof Error &&
          err.message.toLowerCase().includes("timed out")
        ) {
          timedOut = true;
        }

        const category = categorizeError(err, timedOut);

        perBead.push({
          name: bead.name,
          status: "FAILED",
          durationMs,
          error: String(err),
        });

        // Mark all remaining beads as SKIPPED
        for (let j = i + 1; j < manifest.beads.length; j++) {
          perBead.push({
            name: manifest.beads[j].name,
            status: "SKIPPED",
            durationMs: 0,
          });
        }

        this.logger.error("Bead failed", {
          runId,
          bead: bead.name,
          error: String(err).slice(0, 500),
          category,
        });

        // Rollback: cleanup temp dir (warn on failure, never rethrow)
        await tmpDirManager.cleanup(tmpDir);

        const totalDurationMs = Date.now() - startTime;

        this.logger.info("Run summary", {
          runId,
          agentName: manifest.name,
          status: category,
          totalDurationMs,
          perBead: perBead.map((b) => ({ name: b.name, status: b.status })),
        });

        return {
          runId,
          agentName: manifest.name,
          status: category,
          finalOutput: null,
          perBead,
          totalDurationMs,
          failedBeadIndex: i,
          errorCategory: category,
          suggestedDelayMs: category === "TRANSIENT" ? 60_000 : undefined,
          error: String(err),
          beadOutputs,
        };
      }

      i++;
    }

    // All beads succeeded — cleanup and return SUCCESS
    await tmpDirManager.cleanup(tmpDir);

    const totalDurationMs = Date.now() - startTime;
    const lastBead = manifest.beads.at(-1)!;
    const finalOutput = (ctx.previousBeads[lastBead.name]?.output ?? null) as T;

    this.logger.info("Run summary", {
      runId,
      agentName: manifest.name,
      status: "SUCCESS",
      totalDurationMs,
      perBead: perBead.map((b) => ({ name: b.name, status: b.status })),
    });

    return {
      runId,
      agentName: manifest.name,
      status: "SUCCESS",
      finalOutput,
      perBead,
      totalDurationMs,
      beadOutputs,
    };
  }

  /**
   * Validates a pipeline without executing beads or creating temp directories.
   *
   * Checks:
   * 1. Manifest loads successfully (schema, env vars, path containment)
   * 2. All bead types are registered in the registry
   * 3. All prompt files exist on disk
   * 4. All template variables referenced in prompts are resolvable
   *
   * Throws on the first validation failure.
   */
  async dryRun(
    agentDir: string,
    agentsRoot: string,
    configOverrides?: Record<string, string>,
  ): Promise<void> {
    // 1. Load manifest — validates schema, env vars, path containment
    const manifest = await loadManifest(agentDir, agentsRoot);

    // 2. Check all bead types are registered (throws RegistryError if not)
    for (const bead of manifest.beads) {
      this.registry.resolve(bead.type);
    }

    // 3. Check prompt files exist and validate template variables
    const placeholderBuiltIns: Record<string, string> = {
      task_id: "<task_id>",
      run_date: "<run_date>",
      agent_name: "<agent_name>",
      repo_path: "<repo_path>",
    };

    const vars = buildTemplateVars(
      placeholderBuiltIns as Parameters<typeof buildTemplateVars>[0],
      manifest.variables,
      configOverrides ?? {},
      {},
    );

    for (const bead of manifest.beads) {
      const promptPath = path.join(manifest.agentDir, bead.prompt);

      // 3a. Verify prompt file exists
      await fs.access(promptPath);

      // 3b. Validate template variables in the prompt
      const promptContent = await fs.readFile(promptPath, "utf-8");
      validateTemplateVars(promptContent, vars);
    }
  }
}

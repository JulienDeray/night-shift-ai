import type { ResolvedBead, LoadedManifest } from "./manifest-types.js";

/**
 * Raw output from a bead execution.
 * Metadata (duration, model, tokens) is tracked separately by engine logging.
 */
export interface BeadOutput {
  rawOutput: string;
}

/**
 * Execution context for a bead within an agent pipeline.
 *
 * Named AgentPipelineContext to distinguish from:
 * - PipelineContext in agent-types.ts (harness-level dispatch context)
 * - PipelineContext in code-agent-runner.ts (code-agent-specific context)
 */
export interface AgentPipelineContext {
  taskId: string;
  agentName: string;
  agentDir: string;
  workDir: string;
  handoffDir: string;
  manifest: LoadedManifest;
  currentBead: ResolvedBead;
  /** All previous beads' results, keyed by bead name. */
  previousBeads: Record<string, { output: unknown; rawOutput: string }>;
  /** Resolved template variables (built-ins + manifest + config overrides). */
  variables: Record<string, unknown>;
}

/**
 * Plugin interface for bead execution.
 * Single method, no lifecycle hooks — per locked CONTEXT.md decision.
 */
export interface BeadPlugin {
  execute(ctx: AgentPipelineContext): Promise<BeadOutput>;
}

/**
 * Factory function that creates a BeadPlugin instance from resolved config.
 * The registry stores these factories keyed by bead type string.
 */
export type BeadPluginFactory = (
  beadConfig: ResolvedBead,
  manifest: LoadedManifest,
) => BeadPlugin;

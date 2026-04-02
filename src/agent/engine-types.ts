/**
 * Result type system for the AgentEngine pipeline.
 *
 * These types define the typed contracts for pipeline execution outcomes,
 * error categorization, and the generic AgentRunResult used by AgentEngine.
 * Also contains AgentPipelineContext for step execution.
 */

import type { ResolvedStep, LoadedManifest } from "./manifest-types.js";

/** Classifies whether a step failure is recoverable at the engine level. */
export type StepErrorCategory = "FATAL" | "TRANSIENT";

/** Overall pipeline execution status. */
export type PipelineStatus = "SUCCESS" | "FATAL" | "TRANSIENT";

/** Per-step execution outcome tracked in AgentRunResult. */
export interface StepOutcome {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  error?: string;
}

/**
 * Generic result type returned by AgentEngine.run().
 *
 * T is the parsed final-step output type. The engine fills finalOutput only
 * on SUCCESS. On failure, errorCategory, failedStepIndex, and suggestedDelayMs
 * provide enough context for the caller to decide on retry strategy.
 */
export interface AgentRunResult<T = unknown> {
  runId: string;
  agentName: string;
  status: PipelineStatus;
  finalOutput: T | null;
  perStep: StepOutcome[];
  totalDurationMs: number;
  /** Index into perStep of the first failed step — restart-from hint for future loopback. */
  failedStepIndex?: number;
  errorCategory?: StepErrorCategory;
  /** TRANSIENT hint: suggested delay in ms before caller retries. */
  suggestedDelayMs?: number;
  error?: string;
  /** Reason string when pipeline exited early (e.g. 'Nothing to do'). Set by earlyExit.when logic. */
  earlyExitReason?: string;
  /** All step outputs keyed by step name — allows caller to inspect intermediate results. */
  stepOutputs?: Record<string, unknown>;
}

/**
 * Execution context for a step within an agent pipeline.
 */
export interface AgentPipelineContext {
  taskId: string;
  agentName: string;
  agentDir: string;
  /** Flat temp directory for this run (no subdirectories). */
  workDir: string;
  manifest: LoadedManifest;
  currentStep: ResolvedStep;
  /** All previous steps' results, keyed by step name. */
  previousSteps: Record<string, { output: unknown; rawOutput: string }>;
  /** Resolved template variables (built-ins + manifest + config overrides). */
  variables: Record<string, unknown>;
}

/**
 * Result type system for the AgentEngine pipeline.
 *
 * These types define the typed contracts for pipeline execution outcomes,
 * error categorization, and the generic AgentRunResult used by AgentEngine.
 */

/** Classifies whether a bead failure is recoverable at the engine level. */
export type BeadErrorCategory = "FATAL" | "TRANSIENT";

/** Overall pipeline execution status. */
export type PipelineStatus = "SUCCESS" | "FATAL" | "TRANSIENT";

/** Per-bead execution outcome tracked in AgentRunResult. */
export interface BeadOutcome {
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  error?: string;
}

/**
 * Generic result type returned by AgentEngine.run().
 *
 * T is the parsed final-bead output type. The engine fills finalOutput only
 * on SUCCESS. On failure, errorCategory, failedBeadIndex, and suggestedDelayMs
 * provide enough context for the caller to decide on retry strategy.
 */
export interface AgentRunResult<T = unknown> {
  runId: string;
  agentName: string;
  status: PipelineStatus;
  finalOutput: T | null;
  perBead: BeadOutcome[];
  totalDurationMs: number;
  /** Index into perBead of the first failed bead — restart-from hint for future loopback. */
  failedBeadIndex?: number;
  errorCategory?: BeadErrorCategory;
  /** TRANSIENT hint: suggested delay in ms before caller retries. */
  suggestedDelayMs?: number;
  error?: string;
}

/**
 * Validates an agent name: kebab-case, 1-64 chars, not reserved.
 */
export function validateAgentName(name: string): { valid: boolean; error?: string } {
  // Reserved names per CONTEXT.md
  const RESERVED = ['default', 'all', 'none'];
  if (RESERVED.includes(name)) {
    return { valid: false, error: `"${name}" is a reserved agent name` };
  }
  // kebab-case: starts with lowercase letter, contains lowercase letters/digits/hyphens, max 64 chars
  const KEBAB_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$|^[a-z]$/;
  if (!KEBAB_RE.test(name)) {
    return { valid: false, error: `Agent name must be kebab-case, 1-64 chars: "${name}"` };
  }
  return { valid: true };
}

/**
 * Minimal agent configuration stub for Phase 5.
 * Expanded in later phases (manifest path, bead config, etc.).
 */
export interface AgentConfig {
  name: string;   // kebab-case, max 64 chars
  path: string;   // absolute path to agent directory
}

/**
 * Generic pipeline context passed to every agent run.
 * Carries task identity and paths only — no agent-specific data.
 *
 * NOTE: This is a DIFFERENT type from the code-agent-specific PipelineContext
 * in code-agent-runner.ts. That one carries logger, config, gitlabToken etc.
 * This one is the harness-level abstraction for the dispatch layer.
 */
export interface PipelineContext {
  taskId: string;
  agentName: string;
  workDir: string;
  handoffDir: string;
}

/**
 * Generic outcome from any agent run.
 * Agent-specific data (MR URL, summary, etc.) goes in details.
 */
export type AgentRunOutcome = 'SUCCESS' | 'FAILURE' | 'SKIPPED';

export interface AgentRunResult {
  outcome: AgentRunOutcome;
  details: Record<string, unknown>;
}

/**
 * Typed handoff payload for bead-to-bead data passing.
 * All beads write and read this shape from the handoff file.
 */
export interface HandoffPayload {
  [key: string]: unknown;
}

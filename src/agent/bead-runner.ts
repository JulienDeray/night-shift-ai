import { spawnWithTimeout } from "../utils/process.js";
import type { BeadResult } from "./types.js";
import type { ClaudeJsonOutput } from "../core/types.js";

/**
 * Constructs a sanitized environment for a bead invocation.
 *
 * AGENT-08 enforcement point: GITLAB_TOKEN is NEVER passed to analyze,
 * implement, or verify beads. It is only forwarded for the "mr" bead.
 *
 * We start from a minimal allowlist of safe env vars rather than spreading
 * process.env — this prevents accidental token leakage if GITLAB_TOKEN
 * happens to be set in the parent process environment.
 */
export function buildBeadEnv(
  beadName: "analyze" | "implement" | "verify" | "mr",
  gitlabToken: string | undefined,
): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    USER: process.env.USER,
    LANG: process.env.LANG,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
  };

  // Only the MR bead gets GITLAB_TOKEN (needed for `glab mr create`)
  if (beadName === "mr" && gitlabToken) {
    safeEnv.GITLAB_TOKEN = gitlabToken;
  }

  return safeEnv;
}

/**
 * Constructs the Claude CLI argument array for a bead invocation.
 *
 * AGENT-09 enforcement: --allowedTools Bash Read Write restricts the agent
 * to only the minimum needed tools (no WebFetch, browser, MCP tools).
 *
 * Note: --allowedTools values are separate array elements, consistent with
 * the existing AgentRunner.buildArgs pattern in agent-runner.ts.
 *
 * SECURITY: GITLAB_TOKEN is never placed in the args array — it is forwarded
 * only via the env option in buildBeadEnv.
 */
export function buildBeadArgs(
  prompt: string,
  model: string,
  maxTokens?: number,
): string[] {
  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--allowedTools", "Bash", "Read", "Write",
    "--model", model,
  ];

  if (maxTokens !== undefined) {
    args.push("--max-budget-usd", maxTokens.toString());
  }

  return args;
}

/**
 * Runs a single Claude CLI bead invocation.
 *
 * Wraps spawnWithTimeout and returns a BeadResult. Does NOT throw on non-zero
 * exit codes or parse failures — the pipeline orchestrator decides how to
 * handle errors. This allows the orchestrator to implement fallback and retry
 * logic without dealing with exceptions.
 *
 * SECURITY:
 * - env is always constructed via buildBeadEnv (never process.env directly)
 * - GITLAB_TOKEN only forwarded for the "mr" bead
 * - Rendered prompt is never logged (may contain sensitive repo analysis)
 */
export async function runBead(options: {
  beadName: "analyze" | "implement" | "verify" | "mr";
  prompt: string;
  model: string;
  cwd: string;
  timeoutMs: number;
  gitlabToken?: string;
  maxTokens?: number;
}): Promise<BeadResult> {
  const env = buildBeadEnv(options.beadName, options.gitlabToken);
  const args = buildBeadArgs(options.prompt, options.model, options.maxTokens);

  const { result } = spawnWithTimeout("claude", args, {
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env,
  });

  const spawnResult = await result;

  // Attempt to parse JSON output from claude -p
  // On parse failure, populate BeadResult with error info but do NOT throw
  let costUsd = 0;
  let durationMs = spawnResult.timedOut ? options.timeoutMs : 0;
  let stdout = spawnResult.stdout;

  if (spawnResult.exitCode === 0 && spawnResult.stdout) {
    try {
      const parsed = JSON.parse(spawnResult.stdout) as ClaudeJsonOutput;
      costUsd = parsed.total_cost_usd ?? 0;
      durationMs = parsed.duration_ms ?? durationMs;
      stdout = spawnResult.stdout;
    } catch {
      // Non-JSON stdout — leave costUsd/durationMs at defaults
      // stdout already set to raw output
    }
  }

  return {
    exitCode: spawnResult.exitCode ?? -1,
    stdout,
    stderr: spawnResult.stderr,
    durationMs,
    costUsd,
    timedOut: spawnResult.timedOut,
  };
}

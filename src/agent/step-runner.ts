import { spawnWithTimeout } from "../utils/process.js";

/** Minimal shape of the JSON output produced by `claude -p --output-format json`. */
interface ClaudeJsonOutput {
  session_id: string;
  duration_ms: number;
  total_cost_usd: number;
  result: string;
  is_error: boolean;
  num_turns: number;
}

/**
 * Result type for a single step invocation.
 */
export interface StepResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  costUsd: number;
  timedOut: boolean;
}

/**
 * Constructs a sanitized environment for a step invocation.
 *
 * We start from a minimal allowlist of safe env vars rather than spreading
 * process.env — this prevents accidental token leakage. Additional env vars
 * declared in the manifest (e.g. GITLAB_TOKEN, BAMBOOHR_API_KEY) are
 * forwarded explicitly via the envVars parameter.
 */
export function buildStepEnv(
  stepName: string,
  envVars?: Array<{ name: string; value: string }>,
): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    USER: process.env.USER,
    LANG: process.env.LANG,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
  };

  // Forward all declared step env vars (from manifest env entries)
  if (envVars) {
    for (const entry of envVars) {
      safeEnv[entry.name] = entry.value;
    }
  }

  return safeEnv;
}

/**
 * Constructs the Claude CLI argument array for a step invocation.
 *
 * AGENT-09 enforcement: --allowedTools Bash Read Write restricts the agent
 * to only the minimum needed tools (no WebFetch, browser, MCP tools).
 *
 * Note: --allowedTools values are separate array elements, consistent with
 * the existing AgentRunner.buildArgs pattern in agent-runner.ts.
 *
 * SECURITY: Secrets are never placed in the args array — they are forwarded
 * only via the env option in buildStepEnv.
 *
 * When options.allowedTools is provided, it replaces the default ["Bash", "Read", "Write"].
 * When options.mcpConfigPath is provided, "--mcp-config <path>" is appended to args.
 */
export function buildStepArgs(
  prompt: string,
  model: string,
  maxTokens?: number,
  options?: {
    mcpConfigPath?: string;
    allowedTools?: string[];
  },
): string[] {
  const allowedTools = options?.allowedTools ?? ["Bash", "Read", "Write"];

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--allowedTools", ...allowedTools,
    "--model", model,
  ];

  if (maxTokens !== undefined) {
    args.push("--max-budget-usd", maxTokens.toString());
  }

  if (options?.mcpConfigPath !== undefined) {
    args.push("--mcp-config", options.mcpConfigPath);
  }

  return args;
}

/**
 * Runs a single Claude CLI step invocation.
 *
 * Wraps spawnWithTimeout and returns a StepResult. Does NOT throw on non-zero
 * exit codes or parse failures — the pipeline orchestrator decides how to
 * handle errors. This allows the orchestrator to implement fallback and retry
 * logic without dealing with exceptions.
 *
 * SECURITY:
 * - env is always constructed via buildStepEnv (never process.env directly)
 * - Only env vars explicitly declared in the manifest are forwarded
 * - Rendered prompt is never logged (may contain sensitive repo analysis)
 */
export async function runStep(options: {
  stepName: string;
  prompt: string;
  model: string;
  cwd: string;
  timeoutMs: number;
  maxTokens?: number;
  mcpConfigPath?: string;
  allowedTools?: string[];
  envVars?: Array<{ name: string; value: string }>;
}): Promise<StepResult> {
  const env = buildStepEnv(options.stepName, options.envVars);
  const args = buildStepArgs(options.prompt, options.model, options.maxTokens, {
    mcpConfigPath: options.mcpConfigPath,
    allowedTools: options.allowedTools,
  });

  const { result } = spawnWithTimeout("claude", args, {
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env,
  });

  const spawnResult = await result;

  // Attempt to parse JSON output from claude -p
  // On parse failure, populate StepResult with error info but do NOT throw
  let costUsd = 0;
  let durationMs = spawnResult.timedOut ? options.timeoutMs : 0;
  let stdout = spawnResult.stdout;

  if (spawnResult.exitCode === 0 && spawnResult.stdout) {
    try {
      const parsed = JSON.parse(spawnResult.stdout) as ClaudeJsonOutput;
      costUsd = parsed.total_cost_usd ?? 0;
      durationMs = parsed.duration_ms ?? durationMs;
      stdout = parsed.result;
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

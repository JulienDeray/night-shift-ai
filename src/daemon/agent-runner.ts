import type { ChildProcess } from "node:child_process";
import { spawnWithTimeout, parseTimeout } from "../utils/process.js";
import { AgentExecutionError } from "../core/errors.js";
import type { NightShiftTask, AgentExecutionResult, ClaudeJsonOutput } from "../core/types.js";
import type { Logger } from "../core/logger.js";

export interface AgentRunnerOptions {
  workspaceDir: string;
  logger: Logger;
}

/**
 * Manages a single claude -p invocation lifecycle:
 * spawn, monitor, timeout, collect JSON result.
 *
 * Uses child_process.spawn (via spawnWithTimeout) for safe
 * argument passing - no shell injection risk.
 */
export class AgentRunner {
  private process: ChildProcess | null = null;
  private readonly workspace: string;
  private readonly logger: Logger;

  constructor(options: AgentRunnerOptions) {
    this.workspace = options.workspaceDir;
    this.logger = options.logger;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async run(task: NightShiftTask): Promise<AgentExecutionResult> {
    const timeoutMs = parseTimeout(task.timeout);
    const args = this.buildArgs(task);

    this.logger.info(`Starting agent for task ${task.id}`, {
      taskName: task.name,
      timeout: task.timeout,
      model: task.model,
    });

    const { process: child, result } = spawnWithTimeout("claude", args, {
      timeoutMs,
      taskId: task.id,
      cwd: this.workspace,
    });

    this.process = child;

    try {
      const spawnResult = await result;

      if (spawnResult.timedOut) {
        this.logger.warn(`Task ${task.id} timed out after ${task.timeout}`);
        return {
          sessionId: "",
          durationMs: timeoutMs,
          totalCostUsd: 0,
          result: `Task timed out after ${task.timeout}`,
          isError: true,
          numTurns: 0,
        };
      }

      if (spawnResult.exitCode !== 0) {
        const errorMsg = spawnResult.stderr || spawnResult.stdout || "Unknown error";
        this.logger.error(`Task ${task.id} failed with exit code ${spawnResult.exitCode}`, {
          stderr: spawnResult.stderr,
        });
        throw new AgentExecutionError(
          `claude -p exited with code ${spawnResult.exitCode}: ${errorMsg}`,
          task.id,
        );
      }

      // Parse JSON output from claude -p
      const output = this.parseOutput(spawnResult.stdout, task.id);

      this.logger.info(`Task ${task.id} completed`, {
        durationMs: output.durationMs,
        costUsd: output.totalCostUsd,
        numTurns: output.numTurns,
        isError: output.isError,
      });

      return output;
    } finally {
      this.process = null;
    }
  }

  kill(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
  }

  private buildArgs(task: NightShiftTask): string[] {
    const args = [
      "-p",
      task.prompt,
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
    ];

    if (task.allowedTools?.length) {
      args.push("--allowedTools");
      args.push(...task.allowedTools);
    }

    if (task.maxBudgetUsd !== undefined) {
      args.push("--max-budget-usd", task.maxBudgetUsd.toString());
    }

    if (task.model) {
      args.push("--model", task.model);
    }

    if (task.mcpConfig) {
      args.push("--mcp-config", task.mcpConfig);
    }

    args.push(
      "--append-system-prompt",
      `You are executing a night-shift task autonomously. Task: ${task.name}. Write output files to: ${this.workspace}. Provide a clear summary of what you did.`,
    );

    return args;
  }

  private parseOutput(stdout: string, taskId: string): AgentExecutionResult {
    try {
      const raw = JSON.parse(stdout) as ClaudeJsonOutput;
      return {
        sessionId: raw.session_id,
        durationMs: raw.duration_ms,
        totalCostUsd: raw.total_cost_usd,
        result: raw.result,
        isError: raw.is_error,
        numTurns: raw.num_turns,
      };
    } catch {
      throw new AgentExecutionError(
        `Failed to parse claude output as JSON for task ${taskId}: ${stdout.slice(0, 200)}`,
        taskId,
      );
    }
  }
}

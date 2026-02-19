import { spawn, type ChildProcess } from "node:child_process";
import { TimeoutError } from "../core/errors.js";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid timeout format: ${timeout}. Use e.g. "30m", "2h", "90s", "5000ms"`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown timeout unit: ${unit}`);
  }
}

export function spawnWithTimeout(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    taskId?: string;
  } = {},
): { process: ChildProcess; result: Promise<SpawnResult> } {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = new Promise<SpawnResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // Force kill after 10s if SIGTERM didn't work
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 10000);
      }, options.timeoutMs);
    }

    child.on("close", (exitCode, signal) => {
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (timedOut && options.taskId) {
        reject(
          new TimeoutError(
            `Task ${options.taskId} timed out after ${options.timeoutMs}ms`,
            options.taskId,
            options.timeoutMs!,
          ),
        );
      } else {
        resolve({ stdout, stderr, exitCode, signal, timedOut });
      }
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });

  return { process: child, result };
}

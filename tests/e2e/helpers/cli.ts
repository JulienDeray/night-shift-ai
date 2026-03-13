import path from "node:path";
import { spawnWithTimeout } from "../../../src/utils/process.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN_PATH = path.join(PROJECT_ROOT, "bin/nightshift.ts");

/**
 * Runs a nightshift CLI command against the given workspace directory.
 * Uses npx tsx to run the TypeScript source directly.
 */
export async function run(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { result } = spawnWithTimeout("npx", ["tsx", BIN_PATH, ...args], {
    timeoutMs: 15_000,
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  return result;
}

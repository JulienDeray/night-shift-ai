import { spawnWithTimeout, type SpawnResult } from "../utils/process.js";
import { BeadsError } from "../core/errors.js";
import type { BeadEntry, BeadCreateOptions, BeadUpdateOptions } from "./types.js";

/**
 * Wrapper around the `bd` CLI tool for beads task tracking.
 * Uses spawnWithTimeout (which calls child_process.spawn, not exec)
 * for safe argument passing without shell injection risk.
 */
export class BeadsClient {
  private readonly bin: string;

  constructor(bin: string = "bd") {
    this.bin = bin;
  }

  private async run(args: string[]): Promise<SpawnResult> {
    const { result } = spawnWithTimeout(this.bin, args, { timeoutMs: 30000 });
    return result;
  }

  private async runJson<T>(args: string[]): Promise<T> {
    const res = await this.run([...args, "--json"]);
    if (res.exitCode !== 0) {
      throw new BeadsError(`bd ${args.join(" ")} failed: ${res.stderr}`);
    }
    try {
      return JSON.parse(res.stdout) as T;
    } catch {
      throw new BeadsError(`Failed to parse bd output as JSON: ${res.stdout}`);
    }
  }

  async create(options: BeadCreateOptions): Promise<string> {
    const args = ["create", options.title, "--description", options.description];
    for (const label of options.labels) {
      args.push("--label", label);
    }
    const res = await this.run(args);
    if (res.exitCode !== 0) {
      throw new BeadsError(`Failed to create bead: ${res.stderr}`);
    }
    // bd create outputs the bead ID
    const id = res.stdout.trim();
    if (!id) {
      throw new BeadsError("bd create returned empty ID");
    }
    return id;
  }

  async update(id: string, options: BeadUpdateOptions): Promise<void> {
    const args = ["update", id];
    if (options.claim) {
      args.push("--claim");
    }
    if (options.labels) {
      for (const label of options.labels) {
        args.push("--label", label);
      }
    }
    if (options.description) {
      args.push("--description", options.description);
    }
    const res = await this.run(args);
    if (res.exitCode !== 0) {
      throw new BeadsError(`Failed to update bead ${id}: ${res.stderr}`);
    }
  }

  async close(id: string): Promise<void> {
    const res = await this.run(["close", id]);
    if (res.exitCode !== 0) {
      throw new BeadsError(`Failed to close bead ${id}: ${res.stderr}`);
    }
  }

  async get(id: string): Promise<BeadEntry> {
    return this.runJson<BeadEntry>(["show", id]);
  }

  async listReady(): Promise<BeadEntry[]> {
    return this.runJson<BeadEntry[]>(["ready", "--label", "nightshift"]);
  }

  async listByLabel(label: string): Promise<BeadEntry[]> {
    return this.runJson<BeadEntry[]>(["list", "--label", label]);
  }

  async listAll(): Promise<BeadEntry[]> {
    return this.runJson<BeadEntry[]>(["list", "--label", "nightshift"]);
  }

  async addDependency(childId: string, parentId: string): Promise<void> {
    const res = await this.run(["dep", "add", childId, parentId]);
    if (res.exitCode !== 0) {
      throw new BeadsError(
        `Failed to add dependency ${childId} → ${parentId}: ${res.stderr}`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.run(["--version"]);
      return res.exitCode === 0;
    } catch {
      return false;
    }
  }
}

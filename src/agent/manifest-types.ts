import type { z } from "zod";
import type { Manifest } from "./manifest-schema.js";

/** Raw bead as parsed from manifest YAML, before inheritance resolution. */
export type ManifestBead = Manifest["beads"][number];

/** Resolved env var — always has explicit name and value after resolution. */
export interface ResolvedEnvVar {
  name: string;
  value: string;
}

/**
 * A bead with all inheritance resolved: agent-level defaults applied,
 * env merged, outputSchema compiled to Zod.
 */
export interface ResolvedBead {
  name: string;
  type: string;
  prompt: string;           // relative path to prompt file within agent dir
  model: string;            // resolved: bead ?? agent ?? default
  timeout: string;          // resolved: bead ?? agent ?? default
  allowedTools: string[];   // resolved: bead ?? agent ?? default
  env: ResolvedEnvVar[];    // resolved: agent merged with bead (bead wins collision)
  outputSchema: Record<string, unknown>;        // raw JSON Schema from manifest
  compiledOutputSchema: z.ZodTypeAny;           // compiled at load time via z.fromJSONSchema()
  /** Raw mcpConfig string from manifest (may contain template variables). Not resolved at load time. */
  mcpConfig?: string;
  /** Bead-level retry config. */
  retry?: { maxAttempts: number; retryFrom: string };
}

/**
 * A fully loaded and resolved manifest, ready for engine consumption.
 * All inheritance applied, all outputSchemas compiled, all paths validated.
 */
export interface LoadedManifest {
  name: string;
  description: string;
  agentDir: string;         // absolute path to the agent directory
  variables: Record<string, string>;   // manifest-level variables (before overrides)
  beads: ResolvedBead[];    // fully resolved bead configs
}

/** Re-export Manifest type from schema for convenience. */
export type { Manifest } from "./manifest-schema.js";

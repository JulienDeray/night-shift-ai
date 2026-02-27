import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "./manifest-schema.js";
import type { ManifestBead, ResolvedBead, ResolvedEnvVar, LoadedManifest } from "./manifest-types.js";
import {
  ManifestError,
  ManifestSecurityError,
  BeadContractViolationError,
  BeadOutputMissingError,
} from "../core/errors.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_TIMEOUT = "15m";
const DEFAULT_ALLOWED_TOOLS = ["Bash", "Read", "Write"];

const SECRET_PATTERNS = /token|key|secret|password/i;

/**
 * Verifies that `targetPath` is contained within `rootDir`.
 * Uses realpath() to resolve symlinks before checking containment.
 * Exported so the engine can perform runtime path checks too.
 */
export async function assertContained(
  targetPath: string,
  rootDir: string,
  label: string,
): Promise<void> {
  const resolvedRoot = await fs.realpath(rootDir);
  const resolvedTarget = await fs.realpath(targetPath);
  // Append path.sep before startsWith to avoid "/agents-extra" matching "/agents"
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new ManifestSecurityError(
      `Path containment violation: ${label} resolved to "${resolvedTarget}", ` +
      `which is outside agents root "${resolvedRoot}"`,
    );
  }
}

/**
 * Formats all Zod validation issues as a single multi-line error message.
 * Reports ALL errors at once (not fail-on-first) with file path and field path.
 */
function formatManifestErrors(
  issues: z.ZodIssue[],
  manifestPath: string,
): string {
  const lines = issues.map(
    (issue) =>
      `  ${manifestPath}: ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  return `Manifest validation failed:\n${lines.join("\n")}`;
}

/**
 * Resolves env var entries (passthrough strings or explicit {name,value} objects)
 * to concrete name/value pairs.
 *
 * - Passthrough string: reads from host environment; throws ManifestError if missing.
 * - Explicit {name, value}: uses the provided value; warns if name looks secret-like.
 */
function resolveEnvVars(
  envEntries: Array<string | { name: string; value: string }>,
  context: string,
): ResolvedEnvVar[] {
  return envEntries.map((entry) => {
    if (typeof entry === "string") {
      const value = process.env[entry];
      if (value === undefined) {
        throw new ManifestError(
          `${context}: env var "${entry}" (passthrough) is not set in the host environment`,
        );
      }
      return { name: entry, value };
    }
    // Explicit value — warn if name looks secret-like
    if (SECRET_PATTERNS.test(entry.name)) {
      console.warn(
        `Warning: ${context}: env var "${entry.name}" has a secret-looking name with a hardcoded value. ` +
        `Consider using passthrough syntax instead.`,
      );
    }
    return { name: entry.name, value: entry.value };
  });
}

/**
 * Merges agent-level and bead-level env vars.
 * Bead env vars win on key collision.
 */
function mergeEnv(agentEnv: ResolvedEnvVar[], beadEnv: ResolvedEnvVar[]): ResolvedEnvVar[] {
  const map = new Map<string, ResolvedEnvVar>();
  for (const e of agentEnv) map.set(e.name, e);
  for (const e of beadEnv) map.set(e.name, e);
  return [...map.values()];
}

/**
 * Compiles a raw JSON Schema object to a Zod schema at load time.
 * Throws ManifestError if the schema uses unsupported features.
 */
function compileOutputSchema(
  jsonSchema: Record<string, unknown>,
  beadName: string,
): z.ZodTypeAny {
  try {
    return z.fromJSONSchema(jsonSchema) as z.ZodTypeAny;
  } catch (err) {
    throw new ManifestError(
      `Bead "${beadName}": invalid outputSchema — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Applies inheritance rules to produce a fully resolved bead config:
 * - model/timeout: bead overrides agent-level (which overrides default)
 * - allowedTools: bead replaces agent-level entirely (no merge)
 * - env: bead merges with agent-level (bead wins on collision)
 * - outputSchema: compiled to Zod at resolve time
 */
function resolveBeadConfig(
  manifest: z.infer<typeof ManifestSchema>,
  bead: ManifestBead,
  agentEnv: ResolvedEnvVar[],
): ResolvedBead {
  const beadEnv = bead.env ? resolveEnvVars(bead.env, `bead "${bead.name}"`) : [];
  return {
    name: bead.name,
    type: bead.type,
    prompt: bead.prompt,
    model: bead.model ?? manifest.model ?? DEFAULT_MODEL,
    timeout: bead.timeout ?? manifest.timeout ?? DEFAULT_TIMEOUT,
    allowedTools: bead.allowedTools ?? manifest.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
    env: mergeEnv(agentEnv, beadEnv),
    outputSchema: bead.outputSchema,
    compiledOutputSchema: compileOutputSchema(bead.outputSchema, bead.name),
    mcpConfig: bead.mcpConfig,  // store raw string — NOT resolved to absolute path here
    retry: bead.retry ? { maxAttempts: bead.retry.maxAttempts, retryFrom: bead.retry.retryFrom } : undefined,
  };
}

/**
 * Loads and fully resolves a manifest from the given agent directory.
 *
 * Pipeline:
 * 1. Path containment check (before any file read)
 * 2. Read manifest.yaml
 * 3. Parse YAML
 * 4. Validate with Zod (all errors reported at once)
 * 5. Resolve agent-level env vars
 * 6. Resolve each bead with inheritance + compile output schemas
 * 7. Return LoadedManifest
 */
export async function loadManifest(
  agentDir: string,
  agentsRoot: string,
): Promise<LoadedManifest> {
  // Path containment check before any file read
  await assertContained(agentDir, agentsRoot, "agent directory");

  const manifestPath = path.join(agentDir, "manifest.yaml");

  let content: string;
  try {
    content = await fs.readFile(manifestPath, "utf-8");
  } catch (err) {
    throw new ManifestError(
      `Cannot read manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new ManifestError(
      `Invalid YAML in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ManifestError(formatManifestErrors(result.error.issues, manifestPath));
  }

  const manifest = result.data;

  // Resolve agent-level env vars
  const agentEnv = manifest.env
    ? resolveEnvVars(manifest.env, `agent "${manifest.name}"`)
    : [];

  // Resolve each bead with inheritance
  const resolvedBeads = manifest.beads.map((bead) =>
    resolveBeadConfig(manifest, bead, agentEnv),
  );

  return {
    name: manifest.name,
    description: manifest.description,
    agentDir: await fs.realpath(agentDir),
    variables: manifest.variables ?? {},
    beads: resolvedBeads,
  };
}

/**
 * Extracts the content of the LAST JSON code block from a text string.
 * Matches both ```json and ``` (no language tag) blocks.
 * Returns null if no code blocks found.
 */
export function extractLastJsonBlock(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:json)?\n([\s\S]*?)\n```/g)];
  if (blocks.length === 0) return null;
  return blocks[blocks.length - 1][1];
}

/**
 * Validates a bead's raw output against its compiled output schema.
 *
 * - Extracts the last JSON code block from the output
 * - Throws BeadOutputMissingError if no JSON block found
 * - Throws BeadContractViolationError if JSON is invalid or doesn't match schema
 * - Returns the parsed and validated output data
 */
export function validateBeadOutput(
  rawOutput: string,
  compiledSchema: z.ZodTypeAny,
  beadName: string,
): unknown {
  const jsonBlock = extractLastJsonBlock(rawOutput);
  if (jsonBlock === null) {
    throw new BeadOutputMissingError(
      `BEAD_OUTPUT_MISSING: bead "${beadName}" produced no JSON code block.\n\n` +
      `Output preview: ${rawOutput.slice(0, 500)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new BeadContractViolationError(
      `BEAD_CONTRACT_VIOLATION: bead "${beadName}" produced invalid JSON in code block.\n\n` +
      `Output preview: ${jsonBlock.slice(0, 500)}`,
    );
  }

  const validation = compiledSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i: z.ZodIssue) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new BeadContractViolationError(
      `BEAD_CONTRACT_VIOLATION: bead "${beadName}" output did not match declared schema:\n${issues}\n\n` +
      `Output preview: ${rawOutput.slice(0, 500)}`,
    );
  }

  return parsed;
}

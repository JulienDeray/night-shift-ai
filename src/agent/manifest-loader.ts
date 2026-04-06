import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ManifestSchema } from "./manifest-schema.js";
import type { ManifestStep, ResolvedStep, ResolvedEnvVar, LoadedManifest } from "./manifest-types.js";
import { NightShiftError } from "../core/errors.js";

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
    throw new NightShiftError(
      `Path containment violation: ${label} resolved to "${resolvedTarget}", ` +
      `which is outside agents root "${resolvedRoot}"`,
      "MANIFEST_SECURITY",
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
        throw new NightShiftError(
          `${context}: env var "${entry}" (passthrough) is not set in the host environment`,
          "MANIFEST",
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
 * Merges agent-level and step-level env vars.
 * Step env vars win on key collision.
 */
function mergeEnv(agentEnv: ResolvedEnvVar[], stepEnv: ResolvedEnvVar[]): ResolvedEnvVar[] {
  const map = new Map<string, ResolvedEnvVar>();
  for (const e of agentEnv) map.set(e.name, e);
  for (const e of stepEnv) map.set(e.name, e);
  return [...map.values()];
}

/**
 * Transforms JSON Schema objects with `nullable: true` (OpenAPI 3.0-style shorthand)
 * into standard JSON Schema `type: [originalType, "null"]` syntax.
 *
 * Rules:
 * - `nullable: true` with a string `type`: converts to array type and removes `nullable`
 * - `nullable: false`: removes the `nullable` key without changing `type`
 * - Recursively processes `properties` and `items`
 * - Returns a new object (does not mutate input)
 */
export function preprocessNullable(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };

  // Handle nullable at this level
  if ("nullable" in result) {
    const nullable = result.nullable;
    delete result.nullable;
    if (nullable === true && typeof result.type === "string") {
      result.type = [result.type, "null"];
    }
  }

  // Recurse into properties
  if (result.properties && typeof result.properties === "object" && result.properties !== null) {
    const processedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        processedProps[key] = preprocessNullable(value as Record<string, unknown>);
      } else {
        processedProps[key] = value;
      }
    }
    result.properties = processedProps;
  }

  // Recurse into items (object form only)
  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = preprocessNullable(result.items as Record<string, unknown>);
  }

  return result;
}

/**
 * Compiles a raw JSON Schema object to a Zod schema at load time.
 * Throws ManifestError if the schema uses unsupported features.
 */
function compileOutputSchema(
  jsonSchema: Record<string, unknown>,
  stepName: string,
): z.ZodTypeAny {
  try {
    return z.fromJSONSchema(preprocessNullable(jsonSchema)) as z.ZodTypeAny;
  } catch (err) {
    throw new NightShiftError(
      `Step "${stepName}": invalid outputSchema — ${err instanceof Error ? err.message : String(err)}`,
      "MANIFEST",
    );
  }
}

/**
 * Applies inheritance rules to produce a fully resolved step config:
 * - model/timeout: step overrides agent-level (which overrides default)
 * - allowedTools: step replaces agent-level entirely (no merge)
 * - env: step merges with agent-level (step wins on collision)
 * - outputSchema: compiled to Zod at resolve time
 */
function resolveStepConfig(
  manifest: z.infer<typeof ManifestSchema>,
  step: ManifestStep,
  agentEnv: ResolvedEnvVar[],
): ResolvedStep {
  const stepEnv = step.env ? resolveEnvVars(step.env, `step "${step.name}"`) : [];
  return {
    name: step.name,
    prompt: step.prompt,
    model: step.model ?? manifest.model ?? DEFAULT_MODEL,
    timeout: step.timeout ?? manifest.timeout ?? DEFAULT_TIMEOUT,
    allowedTools: step.allowedTools ?? manifest.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
    env: mergeEnv(agentEnv, stepEnv),
    outputSchema: step.outputSchema,
    compiledOutputSchema: compileOutputSchema(step.outputSchema, step.name),
    mcpConfig: step.mcpConfig,  // store raw string — NOT resolved to absolute path here
    retry: step.retry ? { maxAttempts: step.retry.maxAttempts, retryFrom: step.retry.retryFrom } : undefined,
    earlyExit: step.earlyExit ? { when: step.earlyExit.when, reason: step.earlyExit.reason } : undefined,
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
 * 6. Resolve each step with inheritance + compile output schemas
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
    throw new NightShiftError(
      `Cannot read manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      "MANIFEST",
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new NightShiftError(
      `Invalid YAML in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      "MANIFEST",
    );
  }

  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new NightShiftError(formatManifestErrors(result.error.issues, manifestPath), "MANIFEST");
  }

  const manifest = result.data;

  // Resolve agent-level env vars
  const agentEnv = manifest.env
    ? resolveEnvVars(manifest.env, `agent "${manifest.name}"`)
    : [];

  // Resolve each step with inheritance
  const resolvedSteps = manifest.steps.map((step) =>
    resolveStepConfig(manifest, step, agentEnv),
  );

  const resolvedAgentDir = await fs.realpath(agentDir);

  // Resolve stateDir to absolute path and validate containment within agent dir
  let resolvedStateDir: string | undefined;
  if (manifest.stateDir) {
    resolvedStateDir = path.join(resolvedAgentDir, manifest.stateDir);
    // Validate the resolved path stays within the agent directory.
    // assertContained needs both paths to exist on disk (it calls realpath),
    // but stateDir may not exist yet. Normalize and check prefix instead.
    const normalizedStateDir = path.normalize(resolvedStateDir);
    const agentDirWithSep = resolvedAgentDir.endsWith(path.sep)
      ? resolvedAgentDir
      : resolvedAgentDir + path.sep;
    if (normalizedStateDir !== resolvedAgentDir && !normalizedStateDir.startsWith(agentDirWithSep)) {
      throw new NightShiftError(
        `Path containment violation: stateDir resolved to "${normalizedStateDir}", ` +
        `which is outside agent directory "${resolvedAgentDir}"`,
        "MANIFEST_SECURITY",
      );
    }
  }

  return {
    name: manifest.name,
    description: manifest.description,
    agentDir: resolvedAgentDir,
    variables: manifest.variables ?? {},
    steps: resolvedSteps,
    stateDir: resolvedStateDir,
    rawImports: manifest.imports,
  };
}

/**
 * Extracts the content of the LAST JSON code block from a text string.
 * Matches both ```json and ``` (no language tag) blocks.
 * Tolerates trailing whitespace on fence lines and \r\n line endings.
 * Falls back to parsing the entire trimmed text as bare JSON if no fenced block is found.
 * Returns null if no code blocks and no bare JSON found.
 */
export function extractLastJsonBlock(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)];
  if (blocks.length > 0) return blocks[blocks.length - 1][1];

  // Fallback: if the entire output is bare JSON (no fences), accept it
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Not valid JSON — fall through
    }
  }

  return null;
}

/**
 * Validates a step's raw output against its compiled output schema.
 *
 * - Extracts the last JSON code block from the output
 * - Throws StepOutputMissingError if no JSON block found
 * - Throws StepContractViolationError if JSON is invalid or doesn't match schema
 * - Returns the parsed and validated output data
 */
export function validateStepOutput(
  rawOutput: string,
  compiledSchema: z.ZodTypeAny,
  stepName: string,
): unknown {
  const jsonBlock = extractLastJsonBlock(rawOutput);
  if (jsonBlock === null) {
    throw new NightShiftError(
      `STEP_OUTPUT_MISSING: step "${stepName}" produced no JSON code block.\n\n` +
      `Output preview: ${rawOutput.slice(0, 500)}`,
      "STEP_OUTPUT_MISSING",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new NightShiftError(
      `STEP_CONTRACT_VIOLATION: step "${stepName}" produced invalid JSON in code block.\n\n` +
      `Output preview: ${jsonBlock.slice(0, 500)}`,
      "STEP_CONTRACT_VIOLATION",
    );
  }

  const validation = compiledSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i: z.ZodIssue) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new NightShiftError(
      `STEP_CONTRACT_VIOLATION: step "${stepName}" output did not match declared schema:\n${issues}\n\n` +
      `Output preview: ${rawOutput.slice(0, 500)}`,
      "STEP_CONTRACT_VIOLATION",
    );
  }

  return parsed;
}

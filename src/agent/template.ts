import { format } from "date-fns";
import { NightShiftError } from "../core/errors.js";

export const BUILT_IN_VARS = [
  "task_id",
  "run_date",
  "agent_name",
  "repo_path",
] as const;

type BuiltInVar = (typeof BUILT_IN_VARS)[number];

/**
 * Combined list of all reserved variable names: BUILT_IN_VARS + engine-injected vars.
 * Used for collision checking — user-defined and import variable names must not use these.
 */
export const RESERVED_VAR_NAMES: readonly string[] = [
  ...BUILT_IN_VARS,
  "state_dir",
];

/**
 * Validates that user-defined variable names do not collide with reserved names.
 * Throws ManifestError if any collision is found — hard error, not a warning.
 */
export function validateVariableNames(userVarNames: string[]): void {
  const collisions = userVarNames.filter((name) =>
    RESERVED_VAR_NAMES.includes(name),
  );
  if (collisions.length > 0) {
    throw new NightShiftError(
      `Variable name collision with built-ins: ${collisions.join(", ")}. ` +
        `Reserved names: ${RESERVED_VAR_NAMES.join(", ")}`,
      "MANIFEST",
    );
  }
}

/**
 * Merges variables with the following precedence (highest to lowest):
 *   built-ins > nightshift.yaml config overrides > manifest defaults
 * Step outputs are nested under the "steps" namespace.
 */
export function buildTemplateVars(
  builtIns: Record<BuiltInVar, string>,
  manifestVars: Record<string, string>,
  configOverrides: Record<string, string>,
  stepOutputs: Record<string, { output: unknown; rawOutput: string }>,
): Record<string, unknown> {
  // Start with lowest precedence, overwrite with higher
  const merged: Record<string, unknown> = { ...manifestVars, ...configOverrides };

  // Step outputs accessible under "steps" namespace
  const steps: Record<string, unknown> = {};
  for (const [stepName, result] of Object.entries(stepOutputs)) {
    steps[stepName] = { output: result.output, rawOutput: result.rawOutput };
  }
  merged.steps = steps;

  // Built-ins have highest precedence — overwrite anything
  for (const [key, value] of Object.entries(builtIns)) {
    merged[key] = value;
  }

  return merged;
}

/**
 * Resolves a dot-notation / array-index path through a nested object.
 * Example: "steps.analyze.output.results[0].name"
 */
export function resolveNestedValue(
  obj: Record<string, unknown>,
  pathStr: string,
): unknown {
  // Normalize array indexing: foo[0].bar → foo.0.bar
  const normalized = pathStr.replace(/\[(\d+)\]/g, ".$1");
  const parts = normalized.split(".");
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== "object") return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/**
 * Renders an agent prompt template, substituting all {{placeholder}} patterns.
 * Supports dot notation and array indexing.
 * Arrays and objects are JSON-serialized when injected.
 * Undefined placeholders are left as-is (validateTemplateVars catches these at load time).
 */
export function renderAgentTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{([a-zA-Z0-9_.[\]]+)\}\}/g,
    (match, key: string) => {
      const value = resolveNestedValue(vars, key);
      if (value === undefined) return match; // leave placeholder
      if (value === null) return "null";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    },
  );
}

/**
 * Validates at load time that all non-steps.* placeholders in the template
 * are present in vars. Throws ManifestError if any are undefined.
 * steps.* references are skipped — they are only resolved at runtime.
 */
export function validateTemplateVars(
  template: string,
  vars: Record<string, unknown>,
): void {
  const placeholders = [
    ...template.matchAll(/\{\{([a-zA-Z0-9_.[\]]+)\}\}/g),
  ].map((m) => m[1]);

  const unresolved = placeholders.filter((key) => {
    // Skip steps.* references — only resolved at runtime
    if (key.startsWith("steps.")) return false;
    return resolveNestedValue(vars, key) === undefined;
  });

  if (unresolved.length > 0) {
    throw new NightShiftError(
      `Prompt references undefined variables: ${unresolved.join(", ")}`,
      "MANIFEST",
    );
  }
}

/**
 * Constructs the built-in variables map for a given agent run.
 * run_date is computed at call time.
 */
export function buildBuiltIns(
  taskId: string,
  agentName: string,
  repoPath: string,
): Record<BuiltInVar, string> {
  return {
    task_id: taskId,
    run_date: format(new Date(), "yyyy-MM-dd"),
    agent_name: agentName,
    repo_path: repoPath,
  };
}

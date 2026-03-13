import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { validateAgentName } from "./agent-types.js";
import { getConfigPath } from "../core/paths.js";

export interface ScaffoldResult {
  agentDir: string;
  configUpdated: boolean;
  message: string;
}

/**
 * Creates a new agent directory with manifest.yaml and prompt stubs,
 * and optionally registers the agent in nightshift.yaml.
 */
export async function scaffoldAgent(
  name: string,
  options: { force?: boolean; base?: string } = {},
): Promise<ScaffoldResult> {
  const base = options.base ?? process.cwd();

  // 1. Validate agent name
  const validation = validateAgentName(name);
  if (!validation.valid) {
    throw new Error(validation.error!);
  }

  // 2. Resolve agent directory
  const agentDir = path.resolve(base, "agents", name);
  const promptsDir = path.join(agentDir, "prompts");

  // 3. Handle existing directory
  try {
    await fs.access(agentDir);
    // Directory exists
    if (!options.force) {
      throw new Error(
        `Agent directory already exists: ${agentDir}\nUse --force to overwrite.`,
      );
    }
    await fs.rm(agentDir, { recursive: true, force: true });
  } catch (err) {
    // If it's our own error (not ENOENT), re-throw
    if (err instanceof Error && !("code" in err)) throw err;
  }

  // 4. Create directories
  await fs.mkdir(promptsDir, { recursive: true });

  // 5. Write manifest.yaml
  const manifest = {
    name,
    description: "A scaffolded night-shift agent",
    model: "claude-sonnet-4-6",
    timeout: "15m",
    allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
    steps: [
      {
        name: "analyze",
        prompt: "prompts/analyze.md",
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "string" },
            summary: { type: "string" },
          },
          required: ["result", "summary"],
        },
      },
    ],
  };

  await fs.writeFile(
    path.join(agentDir, "manifest.yaml"),
    stringifyYaml(manifest),
    "utf-8",
  );

  // 6. Write preamble.md
  await fs.writeFile(
    path.join(promptsDir, "preamble.md"),
    `You are the ${name} agent. Follow the task instructions carefully and produce structured JSON output.\n`,
    "utf-8",
  );

  // 7. Write analyze.md
  await fs.writeFile(
    path.join(promptsDir, "analyze.md"),
    `Analyze the repository and produce a structured summary.

Output your analysis as a JSON object in a code block with the following schema:

\`\`\`json
{
  "result": "analysis complete",
  "summary": "placeholder analysis"
}
\`\`\`

Replace the placeholder values with your actual analysis results.
The "result" field should describe the outcome and "summary" should contain a brief overview.
`,
    "utf-8",
  );

  // 9. Update nightshift.yaml
  let configUpdated = false;
  const configPath = getConfigPath(base);

  try {
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(configContent) as Record<string, unknown>;

    // Append to agents array
    if (!Array.isArray(config.agents)) {
      config.agents = [];
    }
    (config.agents as Array<Record<string, unknown>>).push({ name });

    // Append to schedule array
    if (!Array.isArray(config.schedule)) {
      config.schedule = [];
    }
    (config.schedule as Array<Record<string, unknown>>).push({
      agent: name,
      cron: "0 2 * * *",
    });

    await fs.writeFile(configPath, stringifyYaml(config), "utf-8");
    configUpdated = true;
  } catch {
    console.warn(
      "nightshift.yaml not found \u2014 run 'nightshift init' first, then add this agent manually",
    );
  }

  // 10. Build next-steps message
  const message = [
    "Next steps:",
    `  1. Edit steps and prompts in agents/${name}/prompts/`,
    `  2. Add variables to nightshift.yaml if needed`,
    `  3. Run 'nightshift agent validate ${name}' to check`,
    `  4. Run 'nightshift run --agent ${name}' to test`,
  ].join("\n");

  return { agentDir, configUpdated, message };
}

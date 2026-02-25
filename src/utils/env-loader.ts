import fs from "node:fs";
import path from "node:path";

/**
 * Loads environment variables from a `.env` file into `process.env`.
 *
 * Rules:
 * - Silently ignores missing `.env` file
 * - Only sets variables that are NOT already defined in `process.env`
 *   (existing shell-exported values always take precedence)
 * - Handles `KEY=VALUE`, `KEY="VALUE"`, `KEY='VALUE'`, comments (#), and blank lines
 * - No external dependencies, no multiline values, no variable interpolation
 *
 * @param base - Directory to look for `.env` file (defaults to `process.cwd()`)
 */
export function loadEnvFile(base?: string): void {
  const envPath = path.resolve(base ?? process.cwd(), ".env");

  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip blank lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2].trim();

    // Strip surrounding quotes (double or single)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined — shell-exported values take precedence
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

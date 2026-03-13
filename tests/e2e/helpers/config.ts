import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURES_AGENTS_DIR = path.join(
  PROJECT_ROOT,
  "tests/e2e/fixtures/agents",
);
const DEFAULT_RESPONSE_FILE = path.join(
  PROJECT_ROOT,
  "tests/e2e/fixtures/mock-claude/responses/success.json",
);
const FAILURE_RESPONSE_FILE = path.join(
  PROJECT_ROOT,
  "tests/e2e/fixtures/mock-claude/responses/failure.json",
);
const RETRY_FAIL_RESPONSE_FILE = path.join(
  PROJECT_ROOT,
  "tests/e2e/fixtures/mock-claude/responses/retry-fail.json",
);

/**
 * Writes nightshift.yaml to tmpDir with E2E-appropriate settings and copies
 * fixture agents into tmpDir/agents/.
 *
 * Sets poll_interval_ms and heartbeat_interval_ms low for fast test execution.
 */
export async function writeE2EConfig(
  tmpDir: string,
  options: {
    ntfyPort?: number;
    agentNames?: string[];
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
  } = {},
): Promise<void> {
  const agentNames = options.agentNames ?? ["happy-path-agent"];
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1000;

  const agentsList = agentNames.map((name) => `  - name: ${name}\n    notify: true`).join("\n");

  const ntfyBlock = options.ntfyPort
    ? `
ntfy:
  topic: test-topic
  baseUrl: http://127.0.0.1:${options.ntfyPort}
`
    : "";

  const config = `workspace: ./workspace
inbox: ./inbox
max_concurrent: 2
default_timeout: "30m"

daemon:
  poll_interval_ms: ${pollIntervalMs}
  heartbeat_interval_ms: ${heartbeatIntervalMs}
  log_retention_days: 30

agents_dir: ./agents
agents:
${agentsList}
schedule: []

one_off_defaults:
  timeout: "30m"
${ntfyBlock}`;

  await fs.writeFile(path.join(tmpDir, "nightshift.yaml"), config, "utf-8");

  // Create .nightshift directory structure
  await fs.mkdir(path.join(tmpDir, ".nightshift", "queue"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".nightshift", "inbox"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".nightshift", "logs"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "workspace"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "inbox"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });

  // Copy fixture agents to tmpDir/agents/
  for (const agentName of agentNames) {
    const srcAgentDir = path.join(FIXTURES_AGENTS_DIR, agentName);
    const destAgentDir = path.join(tmpDir, "agents", agentName);
    await copyAgentDir(srcAgentDir, destAgentDir, agentName);
  }
}

/**
 * Recursively copies an agent directory from fixtures to the destination.
 * Rewrites manifest.yaml to replace {{response_file}} with the absolute path
 * to the success.json fixture response file.
 */
async function copyAgentDir(
  srcDir: string,
  destDir: string,
  agentName: string,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyAgentDir(srcPath, destPath, agentName);
    } else {
      let content = await fs.readFile(srcPath, "utf-8");

      // Rewrite manifest.yaml: substitute response file placeholders with actual paths
      if (entry.name === "manifest.yaml") {
        content = content.replace(/\{\{response_file\}\}/g, DEFAULT_RESPONSE_FILE);
        content = content.replace(/\{\{failure_response_file\}\}/g, FAILURE_RESPONSE_FILE);
        content = content.replace(/\{\{retry_fail_response_file\}\}/g, RETRY_FAIL_RESPONSE_FILE);
      }

      await fs.writeFile(destPath, content, "utf-8");
    }
  }
}

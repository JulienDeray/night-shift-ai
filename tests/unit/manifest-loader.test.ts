import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  assertContained,
  loadManifest,
  extractLastJsonBlock,
  validateStepOutput,
  preprocessNullable,
} from "../../src/agent/manifest-loader.js";
import {
  ManifestError,
  ManifestSecurityError,
  StepContractViolationError,
  StepOutputMissingError,
} from "../../src/core/errors.js";

// ---------------------------------------------------------------------------
// Helper: create a temporary agent directory with a manifest.yaml
// ---------------------------------------------------------------------------

async function createTempAgent(
  manifest: Record<string, unknown>,
  options?: { rootName?: string; agentName?: string },
): Promise<{ agentsRoot: string; agentDir: string; cleanup: () => Promise<void> }> {
  const rootName = options?.rootName ?? "agents-root";
  const agentName = options?.agentName ?? "test-agent";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
  const agentsRoot = path.join(tmpDir, rootName);
  const agentDir = path.join(agentsRoot, agentName);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    path.join(agentDir, "manifest.yaml"),
    stringifyYaml(manifest),
  );
  return {
    agentsRoot,
    agentDir,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Minimal valid manifest fixture
// ---------------------------------------------------------------------------

const VALID_MANIFEST = {
  name: "test-agent",
  description: "A test agent for unit tests",
  steps: [
    {
      name: "analyze",
      prompt: "prompts/analyze.md",
      outputSchema: {
        type: "object",
        properties: { result: { type: "string" } },
        required: ["result"],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. Path containment tests (MFST-02)
// ---------------------------------------------------------------------------

describe("assertContained — path containment", () => {
  it("rejects agent directory outside agents root", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const evilAgent = path.join(tmpDir, "evil-agent");
      await fs.mkdir(agentsRoot, { recursive: true });
      await fs.mkdir(evilAgent, { recursive: true });
      await expect(assertContained(evilAgent, agentsRoot, "agent directory")).rejects.toThrow(
        ManifestSecurityError,
      );
      await expect(assertContained(evilAgent, agentsRoot, "agent directory")).rejects.toThrow(
        "Path containment violation",
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink pointing outside agents root", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const outsideDir = path.join(tmpDir, "outside", "evil");
      const linkedAgent = path.join(agentsRoot, "linked-agent");
      await fs.mkdir(agentsRoot, { recursive: true });
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.symlink(outsideDir, linkedAgent);
      await expect(assertContained(linkedAgent, agentsRoot, "agent directory")).rejects.toThrow(
        ManifestSecurityError,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts agent directory within agents root", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const agentDir = path.join(agentsRoot, "my-agent");
      await fs.mkdir(agentDir, { recursive: true });
      await expect(assertContained(agentDir, agentsRoot, "agent directory")).resolves.toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles path separator edge case (agents-extra not a child of agents)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents");
      const agentsExtra = path.join(tmpDir, "agents-extra");
      const fileInExtra = path.join(agentsExtra, "file");
      await fs.mkdir(agentsRoot, { recursive: true });
      await fs.mkdir(fileInExtra, { recursive: true });
      await expect(assertContained(fileInExtra, agentsRoot, "file")).rejects.toThrow(
        ManifestSecurityError,
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Manifest loading tests (MFST-02)
// ---------------------------------------------------------------------------

describe("loadManifest — loading", () => {
  it("loads valid manifest successfully", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent(VALID_MANIFEST);
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.name).toBe("test-agent");
      expect(loaded.description).toBe("A test agent for unit tests");
      expect(loaded.agentDir).toBeTruthy();
      expect(path.isAbsolute(loaded.agentDir)).toBe(true);
      expect(loaded.variables).toEqual({});
      expect(loaded.steps).toHaveLength(1);
      expect(loaded.steps[0].name).toBe("analyze");
    } finally {
      await cleanup();
    }
  });

  it("throws ManifestError for missing manifest file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const agentDir = path.join(agentsRoot, "empty-agent");
      await fs.mkdir(agentDir, { recursive: true });
      // No manifest.yaml written
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow("Cannot read manifest");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws ManifestError for invalid YAML", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const agentDir = path.join(agentsRoot, "bad-yaml-agent");
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "manifest.yaml"),
        "name: valid\nbad: [unclosed bracket",
      );
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow("Invalid YAML");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws ManifestError with all validation errors when multiple fields invalid", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ns-test-"));
    try {
      const agentsRoot = path.join(tmpDir, "agents-root");
      const agentDir = path.join(agentsRoot, "invalid-agent");
      await fs.mkdir(agentDir, { recursive: true });
      // Missing name, description, and steps is empty array (min 1 required)
      await fs.writeFile(
        path.join(agentDir, "manifest.yaml"),
        stringifyYaml({ steps: [] }),
      );
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
      const err = await loadManifest(agentDir, agentsRoot).catch((e) => e);
      expect(err.message).toContain("name");
      expect(err.message).toContain("description");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Inheritance resolution tests (PLUG-04)
// ---------------------------------------------------------------------------

describe("loadManifest — inheritance resolution", () => {
  it("step model overrides agent-level model", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      model: "claude-haiku",
      steps: [{ ...VALID_MANIFEST.steps[0], model: "claude-opus" }],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].model).toBe("claude-opus");
    } finally {
      await cleanup();
    }
  });

  it("step inherits agent-level model when not specified", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      model: "claude-haiku",
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].model).toBe("claude-haiku");
    } finally {
      await cleanup();
    }
  });

  it("step uses default model when neither agent nor step specifies", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent(VALID_MANIFEST);
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].model).toBe("claude-sonnet-4-20250514");
    } finally {
      await cleanup();
    }
  });

  it("step timeout overrides agent-level timeout", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      timeout: "5m",
      steps: [{ ...VALID_MANIFEST.steps[0], timeout: "30m" }],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].timeout).toBe("30m");
    } finally {
      await cleanup();
    }
  });

  it("step inherits agent-level timeout when not specified", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      timeout: "5m",
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].timeout).toBe("5m");
    } finally {
      await cleanup();
    }
  });

  it("step allowedTools replaces agent-level entirely (not merged)", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      allowedTools: ["Bash"],
      steps: [
        { ...VALID_MANIFEST.steps[0], allowedTools: ["Bash", "Read", "Write", "WebFetch"] },
      ],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      expect(loaded.steps[0].allowedTools).toEqual(["Bash", "Read", "Write", "WebFetch"]);
    } finally {
      await cleanup();
    }
  });

  it("step env merges with agent-level env (both kept)", async () => {
    vi.stubEnv("HOME", "/home/test");
    vi.stubEnv("PATH", "/usr/bin");
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      env: ["HOME"],
      steps: [{ ...VALID_MANIFEST.steps[0], env: ["PATH"] }],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const envNames = loaded.steps[0].env.map((e) => e.name);
      expect(envNames).toContain("HOME");
      expect(envNames).toContain("PATH");
    } finally {
      await cleanup();
      vi.unstubAllEnvs();
    }
  });

  it("step env wins collision with agent-level env", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      env: [{ name: "MY_VAR", value: "agent-val" }],
      steps: [
        {
          ...VALID_MANIFEST.steps[0],
          env: [{ name: "MY_VAR", value: "step-val" }],
        },
      ],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const myVar = loaded.steps[0].env.find((e) => e.name === "MY_VAR");
      expect(myVar?.value).toBe("step-val");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Env resolution tests
// ---------------------------------------------------------------------------

describe("loadManifest — env resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passthrough env var resolved from host environment", async () => {
    vi.stubEnv("MY_TOKEN", "abc123");
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      env: ["MY_TOKEN"],
    });
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const token = loaded.steps[0].env.find((e) => e.name === "MY_TOKEN");
      expect(token?.value).toBe("abc123");
    } finally {
      await cleanup();
    }
  });

  it("passthrough env var missing from host throws ManifestError", async () => {
    // Ensure the var is definitely not set
    vi.stubEnv("NONEXISTENT_VAR_12345", undefined as unknown as string);
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      env: ["NONEXISTENT_VAR_12345"],
    });
    try {
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(
        "not set in the host environment",
      );
    } finally {
      await cleanup();
    }
  });

  it("explicit env var with secret-like name logs a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      env: [{ name: "GITLAB_TOKEN", value: "hardcoded-value" }],
    });
    try {
      await loadManifest(agentDir, agentsRoot);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("secret-looking"),
      );
    } finally {
      await cleanup();
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Output schema compilation tests (PLUG-03)
// ---------------------------------------------------------------------------

describe("loadManifest — output schema compilation", () => {
  it("compiles valid outputSchema to Zod at load time", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent(VALID_MANIFEST);
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const compiled = loaded.steps[0].compiledOutputSchema;
      expect(compiled).toBeDefined();
      expect(typeof compiled.safeParse).toBe("function");
    } finally {
      await cleanup();
    }
  });

  it("invalid outputSchema throws ManifestError at load time", async () => {
    const { agentsRoot, agentDir, cleanup } = await createTempAgent({
      ...VALID_MANIFEST,
      steps: [
        {
          ...VALID_MANIFEST.steps[0],
          // INVALID_TYPE is not a valid JSON Schema type
          outputSchema: { type: "INVALID_TYPE" },
        },
      ],
    });
    try {
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow(ManifestError);
      await expect(loadManifest(agentDir, agentsRoot)).rejects.toThrow("invalid outputSchema");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Step output validation tests (PLUG-03)
// ---------------------------------------------------------------------------

describe("validateStepOutput", () => {
  const resultSchema = z.fromJSONSchema({
    type: "object",
    required: ["result"],
    properties: { result: { type: "string" } },
  }) as z.ZodTypeAny;

  it("output matching schema passes and returns parsed value", () => {
    const rawOutput = 'Here is the output:\n```json\n{"result":"ok"}\n```';
    const parsed = validateStepOutput(rawOutput, resultSchema, "test-step");
    expect(parsed).toEqual({ result: "ok" });
  });

  it("output violating schema throws StepContractViolationError", () => {
    const rawOutput = '```json\n{"result":42}\n```';
    expect(() => validateStepOutput(rawOutput, resultSchema, "test-step")).toThrow(
      StepContractViolationError,
    );
    expect(() => validateStepOutput(rawOutput, resultSchema, "test-step")).toThrow(
      "STEP_CONTRACT_VIOLATION",
    );
  });

  it("no JSON block throws StepOutputMissingError", () => {
    const rawOutput = "This is plain text without any code blocks.";
    expect(() => validateStepOutput(rawOutput, resultSchema, "test-step")).toThrow(
      StepOutputMissingError,
    );
    expect(() => validateStepOutput(rawOutput, resultSchema, "test-step")).toThrow(
      "STEP_OUTPUT_MISSING",
    );
  });

  it("uses last JSON block when multiple exist", () => {
    const rawOutput = [
      "First block:",
      "```json",
      '{"result":"first"}',
      "```",
      "Second block:",
      "```json",
      '{"result":"second"}',
      "```",
    ].join("\n");
    const parsed = validateStepOutput(rawOutput, resultSchema, "test-step");
    expect(parsed).toEqual({ result: "second" });
  });
});

// ---------------------------------------------------------------------------
// 7. JSON block extraction tests
// ---------------------------------------------------------------------------

describe("extractLastJsonBlock", () => {
  it("extracts content from a single JSON block", () => {
    const text = '```json\n{"key":"value"}\n```';
    expect(extractLastJsonBlock(text)).toBe('{"key":"value"}');
  });

  it("returns null for text with no code blocks", () => {
    expect(extractLastJsonBlock("plain text, no blocks")).toBeNull();
  });

  it("extracts the last of multiple blocks", () => {
    const text = [
      "```json",
      '{"first":1}',
      "```",
      "some text",
      "```json",
      '{"second":2}',
      "```",
    ].join("\n");
    expect(extractLastJsonBlock(text)).toBe('{"second":2}');
  });

  it("handles block without json language tag", () => {
    const text = "```\n{\"key\":\"value\"}\n```";
    expect(extractLastJsonBlock(text)).toBe('{"key":"value"}');
  });

  it("returns null for empty string", () => {
    expect(extractLastJsonBlock("")).toBeNull();
  });

  it("handles multi-line JSON content", () => {
    const jsonContent = '{\n  "result": "ok",\n  "count": 42\n}';
    const text = `\`\`\`json\n${jsonContent}\n\`\`\``;
    expect(extractLastJsonBlock(text)).toBe(jsonContent);
  });
});

// ---------------------------------------------------------------------------
// 8. preprocessNullable — nullable field transformation
// ---------------------------------------------------------------------------

describe("preprocessNullable — nullable field transformation", () => {
  it("transforms {type: 'string', nullable: true} to {type: ['string', 'null']} and removes nullable key", () => {
    const input = { type: "string", nullable: true };
    const result = preprocessNullable(input);
    expect(result).toEqual({ type: ["string", "null"] });
    expect(result).not.toHaveProperty("nullable");
  });

  it("transforms {type: 'integer', nullable: true} to {type: ['integer', 'null']}", () => {
    const input = { type: "integer", nullable: true };
    const result = preprocessNullable(input);
    expect(result).toEqual({ type: ["integer", "null"] });
  });

  it("recursively processes nested properties in objects", () => {
    const input = {
      type: "object",
      properties: {
        name: { type: "string", nullable: true },
      },
    };
    const result = preprocessNullable(input);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
      },
    });
  });

  it("recursively processes items in arrays", () => {
    const input = {
      type: "array",
      items: { type: "number", nullable: true },
    };
    const result = preprocessNullable(input);
    expect(result).toEqual({
      type: "array",
      items: { type: ["number", "null"] },
    });
  });

  it("leaves fields without nullable: true untouched", () => {
    const input = { type: "string" };
    const result = preprocessNullable(input);
    expect(result).toEqual({ type: "string" });
  });

  it("leaves fields with nullable: false as-is (removes nullable key, does not convert type)", () => {
    const input = { type: "string", nullable: false };
    const result = preprocessNullable(input);
    expect(result).toEqual({ type: "string" });
    expect(result).not.toHaveProperty("nullable");
  });

  it("does not mutate the input object", () => {
    const input = { type: "string", nullable: true };
    preprocessNullable(input);
    expect(input).toEqual({ type: "string", nullable: true });
  });
});

// ---------------------------------------------------------------------------
// 9. Nullable field integration tests (output schema compilation)
// ---------------------------------------------------------------------------

describe("loadManifest — nullable field integration", () => {
  it("manifest with nullable: true on a string property compiles and accepts both string and null", async () => {
    const manifest = {
      ...VALID_MANIFEST,
      steps: [
        {
          ...VALID_MANIFEST.steps[0],
          outputSchema: {
            type: "object",
            properties: {
              result: { type: "string" },
              note: { type: "string", nullable: true },
            },
            required: ["result"],
          },
        },
      ],
    };
    const { agentsRoot, agentDir, cleanup } = await createTempAgent(manifest);
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const compiled = loaded.steps[0].compiledOutputSchema;
      // accepts string value
      expect(compiled.safeParse({ result: "ok", note: "some note" }).success).toBe(true);
      // accepts null value for nullable field
      expect(compiled.safeParse({ result: "ok", note: null }).success).toBe(true);
      // accepts missing optional field
      expect(compiled.safeParse({ result: "ok" }).success).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("manifest without nullable on a string property rejects null", async () => {
    const manifest = {
      ...VALID_MANIFEST,
      steps: [
        {
          ...VALID_MANIFEST.steps[0],
          outputSchema: {
            type: "object",
            properties: {
              result: { type: "string" },
              note: { type: "string" },
            },
            required: ["result"],
          },
        },
      ],
    };
    const { agentsRoot, agentDir, cleanup } = await createTempAgent(manifest);
    try {
      const loaded = await loadManifest(agentDir, agentsRoot);
      const compiled = loaded.steps[0].compiledOutputSchema;
      // rejects null for non-nullable field
      expect(compiled.safeParse({ result: "ok", note: null }).success).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

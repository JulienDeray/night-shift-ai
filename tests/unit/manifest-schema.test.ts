import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ManifestSchema, KNOWN_CLAUDE_TOOLS } from "../../src/agent/manifest-schema.js";

function validManifest(overrides?: Partial<z.input<typeof ManifestSchema>>) {
  return {
    name: "test-agent",
    description: "A test agent",
    beads: [{
      name: "analyze",
      type: "standard",
      prompt: "prompts/analyze.md",
      outputSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
    }],
    ...overrides,
  };
}

describe("ManifestSchema", () => {
  it("valid manifest passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it("missing required fields produces errors identifying each field path", () => {
    const result = ManifestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name");
      expect(paths).toContain("description");
      expect(paths).toContain("beads");
    }
  });

  it("unknown field at root level is rejected (strict)", () => {
    const result = ManifestSchema.safeParse(validManifest({ unknownField: "oops" } as unknown as Partial<z.input<typeof ManifestSchema>>));
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.code);
      expect(codes).toContain("unrecognized_keys");
    }
  });

  it("duplicate bead names are rejected", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "prompts/analyze.md", outputSchema: {} },
        { name: "analyze", type: "standard", prompt: "prompts/other.md", outputSchema: {} },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("Duplicate bead names") && m.includes("analyze"))).toBe(true);
    }
  });

  it("absolute prompt path is rejected", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "/etc/passwd", outputSchema: {} },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("relative path"))).toBe(true);
    }
  });

  it("all errors reported at once (not fail-on-first)", () => {
    // Missing name, description, and beads + unknown field
    const result = ManifestSchema.safeParse({ unknownField: "oops" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("env var passthrough syntax passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      env: ["GITLAB_TOKEN"],
    }));
    expect(result.success).toBe(true);
  });

  it("env var explicit key-value syntax passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      env: [{ name: "GITLAB_TOKEN", value: "xxx" }],
    }));
    expect(result.success).toBe(true);
  });

  it("outputSchema is required on all beads", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "prompts/analyze.md" } as unknown as z.input<typeof ManifestSchema>["beads"][number],
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("outputSchema"))).toBe(true);
    }
  });

  it("variables accepts string record", () => {
    const result = ManifestSchema.safeParse(validManifest({
      variables: { repo: "my-repo", branch: "main" },
    }));
    expect(result.success).toBe(true);
  });

  it("bead with unknown field is rejected (strict)", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "prompts/analyze.md", outputSchema: {}, unknownBeadField: "oops" } as unknown as z.input<typeof ManifestSchema>["beads"][number],
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.code);
      expect(codes).toContain("unrecognized_keys");
    }
  });

  it("unknown tool name in root allowedTools is rejected", () => {
    const result = ManifestSchema.safeParse(validManifest({
      allowedTools: ["Bash", "MagicTool"],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      const errorMsg = messages.find((m) => m.includes('Unknown tool "MagicTool"'));
      expect(errorMsg).toBeDefined();
      expect(errorMsg).toContain(KNOWN_CLAUDE_TOOLS.join(', '));
    }
  });

  it("unknown tool name in bead allowedTools is rejected", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "prompts/analyze.md", outputSchema: {}, allowedTools: ["Bash", "FakeTool"] },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('Unknown tool "FakeTool"'))).toBe(true);
    }
  });

  it("valid tool names in root allowedTools pass validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      allowedTools: ["Bash", "Read", "Write"],
    }));
    expect(result.success).toBe(true);
  });

  it("valid tool names in bead allowedTools pass validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "analyze", type: "standard", prompt: "prompts/analyze.md", outputSchema: {}, allowedTools: ["Bash", "WebFetch", "Grep"] },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("mcp__atlassian__getConfluencePage in allowedTools passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, allowedTools: ["Bash", "mcp__atlassian__getConfluencePage"] },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("mcp__ prefix with underscore-separated parts passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, allowedTools: ["mcp__some__tool", "mcp__other__thing__here"] },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("non-mcp__ unknown tool is still rejected", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, allowedTools: ["Bash", "FakeUnknownTool"] },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('Unknown tool "FakeUnknownTool"'))).toBe(true);
      expect(messages.some((m) => m.includes('mcp__*'))).toBe(true);
    }
  });

  it("mcpConfig literal relative path on a bead passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, mcpConfig: "mcp-config.json" },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("mcpConfig template variable on a bead passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, mcpConfig: "{{mcp_config_path}}" },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("mcpConfig absolute path on a bead fails validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "log", type: "standard", prompt: "prompts/log.md", outputSchema: {}, mcpConfig: "/absolute/path/mcp.json" },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("relative path") || m.includes("template variable"))).toBe(true);
    }
  });

  it("retry with valid retryFrom referencing preceding bead passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "implement", type: "standard", prompt: "prompts/implement.md", outputSchema: {} },
        { name: "verify", type: "standard", prompt: "prompts/verify.md", outputSchema: {}, retry: { maxAttempts: 3, retryFrom: "implement" } },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("retry with retryFrom referencing nonexistent preceding bead fails validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "implement", type: "standard", prompt: "prompts/implement.md", outputSchema: {} },
        { name: "verify", type: "standard", prompt: "prompts/verify.md", outputSchema: {}, retry: { maxAttempts: 3, retryFrom: "nonexistent" } },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("nonexistent") && (m.includes("preceding bead") || m.includes("preceding or current bead")))).toBe(true);
    }
  });

  it("retry with retryFrom referencing current bead (self-retry) passes validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "implement", type: "standard", prompt: "prompts/implement.md", outputSchema: {} },
        { name: "verify", type: "standard", prompt: "prompts/verify.md", outputSchema: {}, retry: { maxAttempts: 3, retryFrom: "verify" } },
      ],
    }));
    expect(result.success).toBe(true);
  });

  it("retry with retryFrom referencing a following bead fails validation", () => {
    const result = ManifestSchema.safeParse(validManifest({
      beads: [
        { name: "implement", type: "standard", prompt: "prompts/implement.md", outputSchema: {}, retry: { maxAttempts: 3, retryFrom: "verify" } },
        { name: "verify", type: "standard", prompt: "prompts/verify.md", outputSchema: {} },
      ],
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("verify") && (m.includes("preceding bead") || m.includes("preceding or current bead")))).toBe(true);
    }
  });
});

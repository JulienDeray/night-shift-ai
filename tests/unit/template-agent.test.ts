import { describe, it, expect } from "vitest";
import {
  validateVariableNames,
  buildTemplateVars,
  resolveNestedValue,
  renderAgentTemplate,
  validateTemplateVars,
  buildBuiltIns,
  BUILT_IN_VARS,
  RESERVED_VAR_NAMES,
} from "../../src/agent/template.js";
import { NightShiftError } from "../../src/core/errors.js";
import { renderTemplate } from "../../src/utils/template.js";

// ---------------------------------------------------------------------------
// 1. Variable name collision detection
// ---------------------------------------------------------------------------

describe("validateVariableNames", () => {
  it("collision with built-in name produces hard error", () => {
    expect(() => validateVariableNames(["task_id", "my_var"])).toThrowError(
      NightShiftError,
    );
    expect(() => validateVariableNames(["task_id", "my_var"])).toThrowError(
      expect.objectContaining({ code: "MANIFEST" }),
    );
    expect(() => validateVariableNames(["task_id", "my_var"])).toThrow(
      /collision/,
    );
    expect(() => validateVariableNames(["task_id", "my_var"])).toThrow(
      /task_id/,
    );
  });

  it("no collision with non-built-in names", () => {
    expect(() =>
      validateVariableNames(["my_var", "repo_name"]),
    ).not.toThrow();
  });

  it("reports all colliding names", () => {
    expect(() =>
      validateVariableNames(["task_id", "run_date", "my_var"]),
    ).toThrow(/task_id/);
    expect(() =>
      validateVariableNames(["task_id", "run_date", "my_var"]),
    ).toThrow(/run_date/);
  });

  it("accepts an empty array without error", () => {
    expect(() => validateVariableNames([])).not.toThrow();
  });

  it("rejects all four built-in names individually", () => {
    for (const name of BUILT_IN_VARS) {
      expect(() => validateVariableNames([name])).toThrowError(NightShiftError);
      expect(() => validateVariableNames([name])).toThrowError(
        expect.objectContaining({ code: "MANIFEST" }),
      );
    }
  });

  it("rejects state_dir as a user variable name", () => {
    expect(() => validateVariableNames(["state_dir"])).toThrowError(NightShiftError);
    expect(() => validateVariableNames(["state_dir"])).toThrowError(
      expect.objectContaining({ code: "MANIFEST" }),
    );
    expect(() => validateVariableNames(["state_dir"])).toThrow(/state_dir/);
  });

  it("rejects state_dir mixed with valid names", () => {
    expect(() => validateVariableNames(["my_var", "state_dir", "other"])).toThrow(/state_dir/);
  });
});

// ---------------------------------------------------------------------------
// 1b. RESERVED_VAR_NAMES
// ---------------------------------------------------------------------------

describe("RESERVED_VAR_NAMES", () => {
  it("includes all BUILT_IN_VARS", () => {
    for (const name of BUILT_IN_VARS) {
      expect(RESERVED_VAR_NAMES).toContain(name);
    }
  });

  it("includes state_dir", () => {
    expect(RESERVED_VAR_NAMES).toContain("state_dir");
  });

  it("has exactly BUILT_IN_VARS.length + 1 entries", () => {
    expect(RESERVED_VAR_NAMES).toHaveLength(BUILT_IN_VARS.length + 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Built-in variable precedence
// ---------------------------------------------------------------------------

const dummyBuiltIns = {
  task_id: "built-in-id",
  run_date: "2026-01-01",
  agent_name: "built-in-name",
  repo_path: "/built-in/path",
};

describe("buildTemplateVars — precedence", () => {
  it("built-ins override config overrides", () => {
    const result = buildTemplateVars(
      dummyBuiltIns,
      {},
      { task_id: "override-id" },
      {},
    );
    expect(result["task_id"]).toBe("built-in-id");
  });

  it("built-ins override manifest defaults", () => {
    const result = buildTemplateVars(
      dummyBuiltIns,
      { agent_name: "manifest-name" },
      {},
      {},
    );
    expect(result["agent_name"]).toBe("built-in-name");
  });

  it("config overrides beat manifest defaults", () => {
    const result = buildTemplateVars(
      dummyBuiltIns,
      { repo: "default" },
      { repo: "overridden" },
      {},
    );
    expect(result["repo"]).toBe("overridden");
  });

  it("step outputs accessible under steps namespace", () => {
    const result = buildTemplateVars(dummyBuiltIns, {}, {}, {
      analyze: { output: { summary: "found issues" }, rawOutput: "raw text" },
    });
    const steps = result["steps"] as Record<string, unknown>;
    expect(steps).toBeDefined();
    const analyze = steps["analyze"] as {
      output: { summary: string };
      rawOutput: string;
    };
    expect(analyze.output.summary).toBe("found issues");
    expect(analyze.rawOutput).toBe("raw text");
  });

  it("manifest defaults are present when not overridden", () => {
    const result = buildTemplateVars(
      dummyBuiltIns,
      { custom: "value" },
      {},
      {},
    );
    expect(result["custom"]).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// 3. Dot notation resolution
// ---------------------------------------------------------------------------

describe("resolveNestedValue — dot notation", () => {
  it("resolves simple key", () => {
    expect(resolveNestedValue({ name: "test" }, "name")).toBe("test");
  });

  it("resolves nested dot notation", () => {
    const obj = {
      steps: { analyze: { output: { summary: "found" } } },
    };
    expect(
      resolveNestedValue(obj, "steps.analyze.output.summary"),
    ).toBe("found");
  });

  it("returns undefined for missing path", () => {
    expect(resolveNestedValue({ a: { b: 1 } }, "a.c")).toBeUndefined();
  });

  it("returns undefined for path through non-object", () => {
    expect(resolveNestedValue({ a: "string" }, "a.b")).toBeUndefined();
  });

  it("returns undefined for completely missing root key", () => {
    expect(resolveNestedValue({ a: 1 }, "b")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Array indexing resolution
// ---------------------------------------------------------------------------

describe("resolveNestedValue — array indexing", () => {
  it("resolves array index", () => {
    expect(resolveNestedValue({ items: ["a", "b", "c"] }, "items[1]")).toBe(
      "b",
    );
  });

  it("resolves nested path with array index", () => {
    const obj = {
      steps: {
        analyze: {
          output: {
            results: [{ name: "first" }, { name: "second" }],
          },
        },
      },
    };
    expect(
      resolveNestedValue(obj, "steps.analyze.output.results[0].name"),
    ).toBe("first");
  });

  it("returns undefined for out-of-bounds index", () => {
    expect(resolveNestedValue({ items: ["a"] }, "items[5]")).toBeUndefined();
  });

  it("resolves index zero", () => {
    expect(
      resolveNestedValue({ items: ["first", "second"] }, "items[0]"),
    ).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// 5. Template rendering
// ---------------------------------------------------------------------------

describe("renderAgentTemplate", () => {
  it("renders simple variables", () => {
    expect(renderAgentTemplate("Hello {{name}}", { name: "world" })).toBe(
      "Hello world",
    );
  });

  it("renders dot notation variables", () => {
    const vars = { steps: { analyze: { output: { summary: "all good" } } } };
    expect(
      renderAgentTemplate("Summary: {{steps.analyze.output.summary}}", vars),
    ).toBe("Summary: all good");
  });

  it("renders array indexed variables", () => {
    expect(
      renderAgentTemplate("First: {{items[0]}}", { items: ["alpha", "beta"] }),
    ).toBe("First: alpha");
  });

  it("JSON-serializes objects", () => {
    expect(
      renderAgentTemplate("Data: {{data}}", { data: { key: "val" } }),
    ).toBe('Data: {"key":"val"}');
  });

  it("JSON-serializes arrays", () => {
    expect(
      renderAgentTemplate("List: {{items}}", { items: [1, 2, 3] }),
    ).toBe("List: [1,2,3]");
  });

  it("leaves undefined placeholders as-is", () => {
    expect(
      renderAgentTemplate("{{known}} {{unknown}}", { known: "yes" }),
    ).toBe("yes {{unknown}}");
  });

  it("renders null as string 'null'", () => {
    expect(renderAgentTemplate("Value: {{val}}", { val: null })).toBe(
      "Value: null",
    );
  });

  it("renders numbers", () => {
    expect(renderAgentTemplate("Count: {{count}}", { count: 42 })).toBe(
      "Count: 42",
    );
  });

  it("renders booleans", () => {
    expect(renderAgentTemplate("Flag: {{flag}}", { flag: true })).toBe(
      "Flag: true",
    );
  });

  it("renders multiple placeholders in a single template", () => {
    const result = renderAgentTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(result).toBe("foo and bar");
  });
});

// ---------------------------------------------------------------------------
// 6. Load-time undefined variable detection
// ---------------------------------------------------------------------------

describe("validateTemplateVars", () => {
  it("throws for undefined static variable", () => {
    expect(() =>
      validateTemplateVars("{{task_id}} {{nonexistent}}", { task_id: "123" }),
    ).toThrowError(NightShiftError);
    expect(() =>
      validateTemplateVars("{{task_id}} {{nonexistent}}", { task_id: "123" }),
    ).toThrowError(expect.objectContaining({ code: "MANIFEST" }));
    expect(() =>
      validateTemplateVars("{{task_id}} {{nonexistent}}", { task_id: "123" }),
    ).toThrow(/undefined variables/);
    expect(() =>
      validateTemplateVars("{{task_id}} {{nonexistent}}", { task_id: "123" }),
    ).toThrow(/nonexistent/);
  });

  it("skips steps.* prefixed variables", () => {
    expect(() =>
      validateTemplateVars(
        "{{task_id}} {{steps.analyze.output.summary}}",
        { task_id: "123" },
      ),
    ).not.toThrow();
  });

  it("passes when all static variables are defined", () => {
    expect(() =>
      validateTemplateVars("{{task_id}} {{repo}}", {
        task_id: "123",
        repo: "my-repo",
      }),
    ).not.toThrow();
  });

  it("reports all undefined variables", () => {
    expect(() => validateTemplateVars("{{a}} {{b}} {{c}}", {})).toThrow(/a/);
    expect(() => validateTemplateVars("{{a}} {{b}} {{c}}", {})).toThrow(/b/);
    expect(() => validateTemplateVars("{{a}} {{b}} {{c}}", {})).toThrow(/c/);
  });

  it("passes for an empty template", () => {
    expect(() => validateTemplateVars("no placeholders here", {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. buildBuiltIns
// ---------------------------------------------------------------------------

describe("buildBuiltIns", () => {
  it("returns all four built-in variables", () => {
    const result = buildBuiltIns("abc123", "code-agent", "/tmp/repo");
    expect(result.task_id).toBe("abc123");
    expect(result.agent_name).toBe("code-agent");
    expect(result.repo_path).toBe("/tmp/repo");
    expect(result.run_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("run_date matches yyyy-MM-dd format", () => {
    const result = buildBuiltIns("t1", "agent", "/repo");
    expect(result.run_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// 8. Backwards compatibility verification
// ---------------------------------------------------------------------------

describe("backwards compatibility — existing renderTemplate", () => {
  it("existing renderTemplate still works with simple vars", () => {
    const result = renderTemplate("Branch: {{date}}-fix", {});
    expect(result).toMatch(/^Branch: \d{4}-\d{2}-\d{2}-fix$/);
  });

  it("existing renderTemplate keeps unknown vars intact", () => {
    const result = renderTemplate("{{unknown}}-test");
    expect(result).toBe("{{unknown}}-test");
  });
});

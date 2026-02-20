import { describe, it, expect } from "vitest";
import { toBeadLabels, toBeadDescription, fromBead } from "../../src/beads/mapper.js";
import type { NightShiftTask } from "../../src/core/types.js";
import type { BeadEntry } from "../../src/beads/types.js";

/** Helper to build a minimal BeadEntry matching real `bd` output */
function makeBead(overrides: Partial<BeadEntry> = {}): BeadEntry {
  return {
    id: "workbench-abc",
    title: "test-task",
    description: "Just a prompt",
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "test@example.com",
    created_at: "2026-02-19T16:52:26Z",
    created_by: "Test User",
    updated_at: "2026-02-19T16:52:26Z",
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

describe("toBeadLabels", () => {
  it("adds nightshift and one-off labels", () => {
    const task: NightShiftTask = {
      id: "ns-1234",
      name: "test",
      origin: "one-off",
      prompt: "do something",
      status: "pending",
      timeout: "30m",
      createdAt: new Date().toISOString(),
    };

    const labels = toBeadLabels(task);
    expect(labels).toContain("nightshift");
    expect(labels).toContain("nightshift:one-off");
  });

  it("adds recurring label with name", () => {
    const task: NightShiftTask = {
      id: "ns-1234",
      name: "standup",
      origin: "recurring",
      prompt: "prep standup",
      status: "pending",
      timeout: "15m",
      createdAt: new Date().toISOString(),
      recurringName: "daily-standup",
    };

    const labels = toBeadLabels(task);
    expect(labels).toContain("nightshift");
    expect(labels).toContain("nightshift:recurring:daily-standup");
  });
});

describe("toBeadDescription", () => {
  it("encodes task metadata in description", () => {
    const task: NightShiftTask = {
      id: "ns-1234",
      name: "test",
      origin: "one-off",
      prompt: "Do the thing",
      status: "pending",
      timeout: "30m",
      maxBudgetUsd: 5.0,
      allowedTools: ["Read", "Write"],
      createdAt: new Date().toISOString(),
    };

    const desc = toBeadDescription(task);
    expect(desc).toContain("---nightshift-meta---");
    expect(desc).toContain("---end-meta---");
    expect(desc).toContain("origin: one-off");
    expect(desc).toContain("timeout: 30m");
    expect(desc).toContain("max_budget_usd: 5");
    expect(desc).toContain("allowed_tools: Read, Write");
    expect(desc).toContain("Do the thing");
  });

  it("omits optional fields when absent", () => {
    const task: NightShiftTask = {
      id: "ns-1234",
      name: "minimal",
      origin: "one-off",
      prompt: "simple task",
      status: "pending",
      timeout: "10m",
      createdAt: new Date().toISOString(),
    };

    const desc = toBeadDescription(task);
    expect(desc).not.toContain("max_budget_usd");
    expect(desc).not.toContain("model");
    expect(desc).not.toContain("allowed_tools");
    expect(desc).not.toContain("output");
  });

  it("includes output field when present", () => {
    const task: NightShiftTask = {
      id: "ns-1234",
      name: "with-output",
      origin: "one-off",
      prompt: "task with output",
      status: "pending",
      timeout: "10m",
      output: "reports/{{name}}-{{date}}.md",
      createdAt: new Date().toISOString(),
    };

    const desc = toBeadDescription(task);
    expect(desc).toContain("output: reports/{{name}}-{{date}}.md");
  });
});

describe("fromBead", () => {
  it("reconstructs a task from a bead entry with labels", () => {
    const bead = makeBead({
      id: "workbench-fgu",
      title: "test-task",
      description:
        "---nightshift-meta---\norigin: one-off\ntimeout: 30m\nmax_budget_usd: 5\nallowed_tools: Read, Write\n---end-meta---\n\nDo the thing",
      labels: ["nightshift", "nightshift:one-off"],
    });

    const task = fromBead(bead);
    expect(task.id).toBe("workbench-fgu");
    expect(task.name).toBe("test-task");
    expect(task.origin).toBe("one-off");
    expect(task.prompt).toBe("Do the thing");
    expect(task.timeout).toBe("30m");
    expect(task.maxBudgetUsd).toBe(5);
    expect(task.allowedTools).toEqual(["Read", "Write"]);
    expect(task.status).toBe("pending");
    expect(task.createdAt).toBe("2026-02-19T16:52:26Z");
  });

  it("handles bd ready output (labels missing)", () => {
    // bd ready strips labels from JSON output
    const bead = makeBead({
      id: "workbench-fgu",
      title: "test1",
      description:
        "---nightshift-meta---\norigin: one-off\ntimeout: 10m\nmax_budget_usd: 5\nmodel: sonnet\n---end-meta---\n\nThink about the meaning of life.",
      labels: undefined,
    });

    const task = fromBead(bead);
    expect(task.id).toBe("workbench-fgu");
    expect(task.name).toBe("test1");
    expect(task.origin).toBe("one-off");
    expect(task.prompt).toBe("Think about the meaning of life.");
    expect(task.timeout).toBe("10m");
    expect(task.maxBudgetUsd).toBe(5);
    expect(task.model).toBe("sonnet");
    expect(task.status).toBe("pending");
  });

  it("detects recurring tasks from labels", () => {
    const bead = makeBead({
      title: "standup-prep",
      description: "---nightshift-meta---\norigin: recurring\ntimeout: 15m\n---end-meta---\n\nPrep standup",
      labels: ["nightshift", "nightshift:recurring:daily-standup"],
    });

    const task = fromBead(bead);
    expect(task.origin).toBe("recurring");
    expect(task.recurringName).toBe("daily-standup");
  });

  it("detects recurring origin from metadata when labels missing", () => {
    const bead = makeBead({
      title: "standup-prep",
      description: "---nightshift-meta---\norigin: recurring\ntimeout: 15m\n---end-meta---\n\nPrep standup",
      labels: undefined,
    });

    const task = fromBead(bead);
    expect(task.origin).toBe("recurring");
  });

  it("maps closed beads to completed status", () => {
    const bead = makeBead({
      status: "closed",
      description: "---nightshift-meta---\norigin: one-off\ntimeout: 30m\n---end-meta---\n\nDone",
    });

    const task = fromBead(bead);
    expect(task.status).toBe("completed");
  });

  it("maps open beads to pending status", () => {
    const bead = makeBead({
      status: "open",
      description: "---nightshift-meta---\norigin: one-off\ntimeout: 30m\n---end-meta---\n\nWaiting",
    });

    const task = fromBead(bead);
    expect(task.status).toBe("pending");
  });

  it("handles description without metadata block", () => {
    const bead = makeBead({
      description: "A plain description with no metadata",
      labels: ["nightshift", "nightshift:one-off"],
    });

    const task = fromBead(bead);
    expect(task.prompt).toBe("A plain description with no metadata");
    expect(task.timeout).toBe("30m"); // default
    expect(task.origin).toBe("one-off");
  });

  it("roundtrips: toBeadDescription → fromBead reconstructs task", () => {
    const original: NightShiftTask = {
      id: "ns-1234",
      name: "roundtrip-test",
      origin: "one-off",
      prompt: "Multi-line\nprompt\nhere",
      status: "pending",
      timeout: "45m",
      maxBudgetUsd: 3.5,
      model: "opus",
      allowedTools: ["Read", "Write", "Bash"],
      createdAt: "2026-02-19T10:00:00Z",
    };

    const description = toBeadDescription(original);
    const bead = makeBead({
      id: original.id,
      title: original.name,
      description,
      labels: toBeadLabels(original),
      created_at: original.createdAt,
    });

    const reconstructed = fromBead(bead);
    expect(reconstructed.name).toBe(original.name);
    expect(reconstructed.origin).toBe(original.origin);
    expect(reconstructed.prompt).toBe(original.prompt);
    expect(reconstructed.timeout).toBe(original.timeout);
    expect(reconstructed.maxBudgetUsd).toBe(original.maxBudgetUsd);
    expect(reconstructed.model).toBe(original.model);
    expect(reconstructed.allowedTools).toEqual(original.allowedTools);
  });

  it("roundtrips output field through toBeadDescription → fromBead", () => {
    const original: NightShiftTask = {
      id: "ns-out1",
      name: "output-roundtrip",
      origin: "recurring",
      prompt: "Task with output path",
      status: "pending",
      timeout: "20m",
      output: "inbox/{{name}}-{{date}}.md",
      createdAt: "2026-02-19T10:00:00Z",
      recurringName: "daily-report",
    };

    const description = toBeadDescription(original);
    const bead = makeBead({
      id: original.id,
      title: original.name,
      description,
      labels: toBeadLabels(original),
      created_at: original.createdAt,
    });

    const reconstructed = fromBead(bead);
    expect(reconstructed.output).toBe("inbox/{{name}}-{{date}}.md");
  });
});

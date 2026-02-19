import { describe, it, expect } from "vitest";
import { toBeadLabels, toBeadDescription, fromBead } from "../../src/beads/mapper.js";
import type { NightShiftTask } from "../../src/core/types.js";
import type { BeadEntry } from "../../src/beads/types.js";

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
});

describe("fromBead", () => {
  it("reconstructs a task from a bead entry", () => {
    const bead: BeadEntry = {
      id: "bd-abc123",
      title: "test-task",
      description:
        "---nightshift-meta---\norigin: one-off\ntimeout: 30m\nmax_budget_usd: 5\nallowed_tools: Read, Write\n---end-meta---\n\nDo the thing",
      labels: ["nightshift", "nightshift:one-off"],
      status: "open",
      claimed: false,
      createdAt: "2026-02-20T00:00:00Z",
      updatedAt: "2026-02-20T00:00:00Z",
    };

    const task = fromBead(bead);
    expect(task.id).toBe("bd-abc123");
    expect(task.name).toBe("test-task");
    expect(task.origin).toBe("one-off");
    expect(task.prompt).toBe("Do the thing");
    expect(task.timeout).toBe("30m");
    expect(task.maxBudgetUsd).toBe(5);
    expect(task.allowedTools).toEqual(["Read", "Write"]);
    expect(task.status).toBe("pending");
  });

  it("detects recurring tasks from labels", () => {
    const bead: BeadEntry = {
      id: "bd-xyz789",
      title: "standup-prep",
      description: "---nightshift-meta---\norigin: recurring\ntimeout: 15m\n---end-meta---\n\nPrep standup",
      labels: ["nightshift", "nightshift:recurring:daily-standup"],
      status: "open",
      claimed: false,
      createdAt: "2026-02-20T00:00:00Z",
      updatedAt: "2026-02-20T00:00:00Z",
    };

    const task = fromBead(bead);
    expect(task.origin).toBe("recurring");
    expect(task.recurringName).toBe("daily-standup");
  });

  it("handles claimed beads as running", () => {
    const bead: BeadEntry = {
      id: "bd-claimed",
      title: "running-task",
      description: "Just a prompt",
      labels: ["nightshift"],
      status: "open",
      claimed: true,
      createdAt: "2026-02-20T00:00:00Z",
      updatedAt: "2026-02-20T00:00:00Z",
    };

    const task = fromBead(bead);
    expect(task.status).toBe("running");
  });
});

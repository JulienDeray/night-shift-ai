import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/template.js";

describe("renderTemplate", () => {
  it("replaces {{date}} with today's date", () => {
    const result = renderTemplate("report-{{date}}.md");
    expect(result).toMatch(/^report-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("replaces custom variables", () => {
    const result = renderTemplate("{{name}}-{{date}}.md", {
      name: "standup",
    });
    expect(result).toMatch(/^standup-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("keeps unknown placeholders intact", () => {
    const result = renderTemplate("{{unknown}}-test");
    expect(result).toBe("{{unknown}}-test");
  });

  it("replaces all built-in variables", () => {
    const result = renderTemplate("{{year}}/{{month}}/{{day}}");
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it("replaces {{datetime}} with date and time", () => {
    const result = renderTemplate("report-{{datetime}}.md");
    // datetime format: YYYY-MM-DD_HH-mm-ss
    expect(result).toMatch(/^report-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
  });

  it("replaces {{time}} with time only", () => {
    const result = renderTemplate("report-{{time}}.md");
    // time format: HH-mm-ss
    expect(result).toMatch(/^report-\d{2}-\d{2}-\d{2}\.md$/);
  });

  it("handles multiple variables in the same template", () => {
    const result = renderTemplate("{{year}}/{{month}}/{{name}}-{{date}}.md", {
      name: "report",
    });
    expect(result).toMatch(/^\d{4}\/\d{2}\/report-\d{4}-\d{2}-\d{2}\.md$/);
  });
});

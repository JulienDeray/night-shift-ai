import { describe, it, expect } from "vitest";
import { parseTimeout, spawnWithTimeout } from "../../src/utils/process.js";

describe("parseTimeout", () => {
  it("parses milliseconds", () => {
    expect(parseTimeout("5000ms")).toBe(5000);
  });

  it("parses seconds", () => {
    expect(parseTimeout("30s")).toBe(30000);
  });

  it("parses minutes", () => {
    expect(parseTimeout("15m")).toBe(900000);
  });

  it("parses hours", () => {
    expect(parseTimeout("2h")).toBe(7200000);
  });

  it("throws on invalid format", () => {
    expect(() => parseTimeout("30")).toThrow("Invalid timeout format");
    expect(() => parseTimeout("abc")).toThrow("Invalid timeout format");
    expect(() => parseTimeout("")).toThrow("Invalid timeout format");
  });
});

describe("spawnWithTimeout", () => {
  it("runs a simple command", async () => {
    const { result } = spawnWithTimeout("echo", ["hello"]);
    const res = await result;
    expect(res.stdout.trim()).toBe("hello");
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
  });

  it("captures stderr", async () => {
    const { result } = spawnWithTimeout("node", ["-e", "console.error('err')"]);
    const res = await result;
    expect(res.stderr.trim()).toBe("err");
    expect(res.exitCode).toBe(0);
  });

  it("returns non-zero exit code", async () => {
    const { result } = spawnWithTimeout("node", ["-e", "process.exit(42)"]);
    const res = await result;
    expect(res.exitCode).toBe(42);
  });

  it("times out long-running process", async () => {
    const { result } = spawnWithTimeout("sleep", ["10"], {
      timeoutMs: 200,
    });
    const res = await result;
    expect(res.timedOut).toBe(true);
  });
});

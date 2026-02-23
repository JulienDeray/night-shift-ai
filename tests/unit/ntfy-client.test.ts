import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NtfyClient } from "../../src/notifications/ntfy-client.js";
import type { NtfyMessage } from "../../src/notifications/ntfy-client.js";
import { Logger } from "../../src/core/logger.js";

function mockFetchOk() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200 });
}

describe("NtfyClient", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = Logger.createCliLogger(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to assembled URL", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await client.send({ title: "Hello", body: "World" }, logger);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://ntfy.example.com/test-topic",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps body to message field in JSON payload", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await client.send({ body: "test body" }, logger);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(payload).toHaveProperty("message", "test body");
    expect(payload).not.toHaveProperty("body");
  });

  it("includes all NtfyMessage fields in payload", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    const message: NtfyMessage = {
      title: "My Title",
      body: "My Body",
      priority: 3,
      tags: ["tag1"],
      actions: [{ action: "view", label: "Open", url: "https://example.com" }],
    };

    await client.send(message, logger);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(payload).toHaveProperty("title", "My Title");
    expect(payload).toHaveProperty("message", "My Body");
    expect(payload).toHaveProperty("priority", 3);
    expect(payload).toHaveProperty("tags");
    expect(payload).toHaveProperty("actions");
  });

  it("includes Authorization header when token is set", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: "tk_secret",
    });

    await client.send({ body: "hello" }, logger);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers).toHaveProperty("Authorization", "Bearer tk_secret");
  });

  it("omits Authorization header when no token", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await client.send({ body: "hello" }, logger);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers).not.toHaveProperty("Authorization");
  });

  it("does not throw on HTTP 4xx/5xx", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", mockFetch);

    const warnSpy = vi.spyOn(logger, "warn");

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await expect(client.send({ body: "hello" }, logger)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Ntfy notification failed",
      expect.objectContaining({ status: 403 }),
    );
  });

  it("does not throw on network error", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", mockFetch);

    const warnSpy = vi.spyOn(logger, "warn");

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await expect(client.send({ body: "hello" }, logger)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Ntfy notification error",
      expect.objectContaining({ error: "fetch failed" }),
    );
  });

  it("does not throw on timeout", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));
    vi.stubGlobal("fetch", mockFetch);

    const warnSpy = vi.spyOn(logger, "warn");

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.example.com",
      token: undefined,
    });

    await expect(client.send({ body: "hello" }, logger)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Ntfy notification error",
      expect.any(Object),
    );
  });

  it("strips trailing slash from baseUrl", async () => {
    const mockFetch = mockFetchOk();
    vi.stubGlobal("fetch", mockFetch);

    const client = new NtfyClient({
      topic: "test-topic",
      baseUrl: "https://ntfy.sh/",
      token: undefined,
    });

    await client.send({ body: "hello" }, logger);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://ntfy.sh/test-topic",
      expect.any(Object),
    );
  });
});

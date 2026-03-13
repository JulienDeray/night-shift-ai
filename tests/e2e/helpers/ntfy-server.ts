import http from "node:http";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface NtfyMockServer {
  port: number;
  getRequests: () => RecordedRequest[];
  close: () => Promise<void>;
}

/**
 * Creates a localhost HTTP mock server that records all incoming requests.
 * Responds with 200 and `{ id: "mock-id" }` for every request.
 * Uses port 0 (OS-assigned) to avoid port conflicts.
 */
export async function createNtfyMockServer(): Promise<NtfyMockServer> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      requests.push({
        method: req.method ?? "?",
        path: req.url ?? "/",
        body: parsed,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "mock-id" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    getRequests: () => [...requests],
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

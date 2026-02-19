import { Orchestrator } from "./orchestrator.js";

const orchestrator = new Orchestrator();

async function shutdown(signal: string): Promise<void> {
  console.error(`Received ${signal}, shutting down...`);
  await orchestrator.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in daemon:", err);
  void orchestrator.stop().then(() => process.exit(1));
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in daemon:", err);
  void orchestrator.stop().then(() => process.exit(1));
});

orchestrator.start().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});

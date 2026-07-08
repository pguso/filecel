import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { WorkerConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { methodNotAllowed, notFound } from "./http/respond.js";
import {
  createPersistMediaQueue,
  startPersistMediaWorker,
  type PersistMediaQueue
} from "./queue/persistMedia.js";
import { handleHealth } from "./routes/health.js";
import { handlePersistMediaJob, handleUploadBinary } from "./routes/jobs.js";

function createRequestHandler(config: WorkerConfig, queue: PersistMediaQueue) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const { pathname } = url;
    const method = req.method ?? "GET";

    try {
      if (pathname === "/health" && method === "GET") {
        handleHealth(res);
        return;
      }

      if (pathname === "/jobs/persist-media" && method === "POST") {
        await handlePersistMediaJob(req, res, config, queue);
        return;
      }

      if (pathname === "/jobs/upload-binary" && method === "POST") {
        await handleUploadBinary(req, res, config);
        return;
      }

      if (
        pathname === "/health" ||
        pathname === "/jobs/persist-media" ||
        pathname === "/jobs/upload-binary"
      ) {
        const allowed =
          pathname === "/health"
            ? ["GET"]
            : ["POST"];
        methodNotAllowed(res, allowed);
        return;
      }

      notFound(res);
    } catch (error) {
      console.error("Request failed:", error);
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const queue = createPersistMediaQueue(config);
  const worker = startPersistMediaWorker(config);

  worker.on("ready", () => {
    console.log(`BullMQ worker listening on queue "${config.queueName}"`);
  });

  worker.on("error", (error) => {
    console.error("BullMQ worker error:", error);
  });

  const server = createServer((req, res) => {
    void createRequestHandler(config, queue)(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      console.log(`Worker API listening on port ${config.port}`);
      resolve();
    });
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close();
    await worker.close();
    await queue.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  console.error("Failed to start worker:", error);
  process.exit(1);
});

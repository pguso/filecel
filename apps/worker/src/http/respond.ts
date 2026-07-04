import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new Error("Request body is required");
  }

  return JSON.parse(raw) as T;
}

export function methodNotAllowed(res: ServerResponse, allowed: string[]): void {
  sendJson(res, 405, { error: "Method not allowed", allowed });
}

export function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { error: "Unauthorized" });
}

export function badRequest(res: ServerResponse, message: string): void {
  sendJson(res, 400, { error: message });
}

export function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "Not found" });
}

import type { ServerResponse } from "node:http";

import { sendJson } from "../http/respond.js";

export function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok" });
}

import type { KeyKind } from "@filecel/r2";

import type { WorkerConfig } from "../config.js";

export type PersistSuccessPayload = {
  generationId: string;
  projectId: string;
  userId: string;
  key: string;
  kind: KeyKind;
  filename?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  metadata?: Record<string, string>;
};

export type PersistFailurePayload = {
  generationId: string;
  error: string;
};

export type PersistWebhookPayload = PersistSuccessPayload | PersistFailurePayload;

export async function notifyPersistWebhook(
  config: WorkerConfig,
  payload: PersistWebhookPayload
): Promise<void> {
  const baseUrl = config.frameuniverse.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/webhooks/filecel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.frameuniverse.webhookSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Frameuniverse webhook failed (${response.status})${body ? `: ${body}` : ""}`
    );
  }
}

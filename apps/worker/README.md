# @filecel/worker

BullMQ service that persists expiring media URLs (e.g. Replicate delivery links) into Cloudflare R2 and notifies Frameuniverse on completion.

## Architecture

1. Your app calls `POST /jobs/persist-media` on this worker (server-side only)
2. BullMQ uploads the file to R2 via `@filecel/r2`
3. On success, the worker POSTs to Frameuniverse's `/webhooks/filecel` endpoint with the R2 key and metadata
4. On final failure after retries, the worker POSTs `{ generationId, error }` so Frameuniverse can mark the generation `FAILED`

Authorization, asset insertion, and URL presigning are handled by Frameuniverse — not this worker.

## Environment

Required variables:

- `WORKER_API_SECRET` — Bearer token for the enqueue API
- `REDIS_URL` — Redis connection string for BullMQ
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 credentials
- `FRAMEUNIVERSE_API_URL` — Base URL of the Frameuniverse API (e.g. `https://api.frameuniverse.com`)
- `FILECEL_WEBHOOK_SECRET` — Bearer token sent to Frameuniverse webhooks

## Local development

```bash
# From repo root
npm ci
npm run build

# Start Redis (Docker)
docker compose -f apps/worker/docker-compose.yml up redis -d

# Configure env (see required variables above)
# Run worker (API + BullMQ processor)
npm run dev -w @filecel/worker
```

## API

### `GET /health`

Returns `{ "status": "ok" }`.

### `POST /jobs/persist-media`

Headers:

```
Authorization: Bearer <WORKER_API_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "userId": "uuid",
  "generationId": "uuid",
  "projectId": "uuid",
  "sourceUrl": "https://replicate.delivery/...",
  "kind": "images",
  "filename": "optional-name.png",
  "metadata": { "predictionId": "..." }
}
```

Required fields: `userId`, `generationId`, `projectId`, `sourceUrl`.

`kind` controls the R2 key path (`images`, `videos`, or `files`; defaults to `files`). The R2 key is deterministic: `users/{userId}/{kind}/{generationId}`.

Response `202`:

```json
{
  "jobId": "persist-media-<generationId>",
  "status": "queued",
  "duplicate": false
}
```

On completion, Frameuniverse receives a webhook with the R2 key (not a public URL).

### `POST /jobs/upload-binary`

Synchronously uploads a base64-encoded reference image to R2. No BullMQ job — use this for ephemeral Replicate model inputs.

Headers:

```
Authorization: Bearer <WORKER_API_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "userId": "uuid",
  "fileName": "image.jpg",
  "mimeType": "image/jpeg",
  "base64": "...",
  "kind": "images"
}
```

Required fields: `userId`, `fileName`, `mimeType`, `base64`.

Validation:

- `mimeType` must be `image/jpeg`, `image/png`, or `image/webp`
- Decoded payload must be non-empty and at most 4 MiB
- `kind` is optional (`images`, `videos`, or `files`; defaults to `images`)

Response `201`:

```json
{
  "key": "users/.../images/....jpg"
}
```

## Vercel integration example

```ts
// app/api/persist-media/route.ts
export async function POST(req: Request) {
  const { generationId, projectId, sourceUrl, userId, kind, filename } = await req.json();

  const res = await fetch(`${process.env.WORKER_URL}/jobs/persist-media`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WORKER_API_SECRET}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ userId, generationId, projectId, sourceUrl, kind, filename })
  });

  return Response.json(await res.json(), { status: res.status });
}
```

## Docker deployment

Build from the **repository root**:

```bash
docker build -f apps/worker/Dockerfile -t filecel-worker .
docker run --env-file apps/worker/.env -p 3000:3000 filecel-worker
```

Or use `docker compose -f apps/worker/docker-compose.yml up -d`.

## VPS deployment (systemd)

1. Clone repo to `/opt/filecel`
2. `npm ci && npm run build`
3. Configure `/etc/filecel/worker.env` with required variables
4. Install `apps/worker/systemd/filecel-worker.service` to `/etc/systemd/system/`
5. `systemctl enable --now filecel-worker`

Put Caddy or nginx in front for TLS. Restrict inbound traffic to your Vercel egress IPs if possible.

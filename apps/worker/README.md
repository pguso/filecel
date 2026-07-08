# @filecel/worker

BullMQ service that persists expiring media URLs (e.g. Replicate delivery links) into Cloudflare R2 and records them in your Supabase `assets` table.

## Architecture

1. Your app creates a `generations` row with `output_url` set to the Replicate delivery URL
2. App calls `POST /jobs/persist-media` on this worker (server-side only)
3. BullMQ uploads the file to R2 via `@filecel/r2`
4. Worker inserts an `assets` row and marks the generation `COMPLETED` (or `FAILED` after retries)

Generation lifecycle is tracked on the `generations` table — not on `assets`.

## Environment

Copy `.env.example` to `.env` and fill in values. Table names and status enum values can be overridden if needed.

Required variables:

- `WORKER_API_SECRET` — Bearer token for the enqueue API
- `REDIS_URL` — Redis connection string for BullMQ
- `R2_*` — Cloudflare R2 credentials
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`

## Local development

```bash
# From repo root
npm ci
npm run build

# Start Redis (Docker)
docker compose -f apps/worker/docker-compose.yml up redis -d

# Configure env
cp apps/worker/.env.example apps/worker/.env

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

`kind` controls the R2 key path (`images`, `videos`, or `files`; defaults to `files`). It maps to `assets.type`:

| `kind` | `assets.type` |
|---|---|
| `images` | `IMAGE` |
| `videos` | `VIDEO` |
| `files` | `IMAGE` |

R2 transform variants are not used in this flow.

Response `202`:

```json
{
  "jobId": "persist-media-<generationId>",
  "status": "queued",
  "duplicate": false
}
```

### `POST /jobs/upload-binary`

Synchronously uploads a base64-encoded reference image to R2. No BullMQ job and no Supabase writes — use this for ephemeral Replicate model inputs.

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
  "storageUrl": "https://media.example.com/users/.../images/....jpg",
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
3. Copy `apps/worker/.env.example` to `/etc/filecel/worker.env` and configure
4. Install `apps/worker/systemd/filecel-worker.service` to `/etc/systemd/system/`
5. `systemctl enable --now filecel-worker`

Put Caddy or nginx in front for TLS. Restrict inbound traffic to your Vercel egress IPs if possible.

## Supabase schema

The worker expects:

- **`generations`** — lifecycle state (`status`, `output_url`, `completed_at`, `error_message`)
- **`assets`** — persisted media (`generation_id`, `project_id`, `type`, `storage_url`, optional `filename`, `file_size_bytes`, etc.)

The worker INSERTs asset rows after upload; it does not update pre-existing asset rows.

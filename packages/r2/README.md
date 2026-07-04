# @filecel/r2

Persist expiring remote media URLs into Cloudflare R2 via streaming uploads.

Stream any remote media URL (public HTTPS, signed URLs, expiring provider URLs, etc.) directly into Cloudflare R2 (S3-compatible) with correct `Content-Type`, retries, metadata, validation, and URL helpers.

This package is meant for the “expiring output URL” reality of many providers: **fetch fast**, **stream to R2**, then store a stable key/URL in your DB.

## What this does (and doesn’t)

- **Does**
  - Fetch a remote URL and upload to R2 **without buffering whole files** (streaming multipart for large/unknown sizes).
  - Buffer small files for lower overhead.
  - Detect and set **Content-Type** (from headers or by sniffing bytes).
  - Attach R2/S3 metadata (`x-amz-meta-*`).
  - Provide delete/list/copy/move/head helpers.
  - Generate **public URLs** (from your `publicBaseUrl`).
  - Generate **Worker-signed URLs** for private buckets (HMAC query string).
  - Run an optional **transform pipeline** at upload time (image resize via `sharp`, video transcode via `ffmpeg`).
- **Doesn’t**
  - Create your bucket, custom domain, or Worker for you by default (but an optional bootstrap CLI can).
  - Call any provider APIs; you pass in the URL (and optionally an idempotency key).

## Optional: Bootstrap Cloudflare (bucket + Worker + domain)

This repo includes an **optional** CLI that can provision the basics via Cloudflare APIs:

- Create an **R2 bucket**
- Upload a **Worker** that validates `exp`/`sig` and serves objects from R2 (binding `BUCKET`)
- Create a **proxied DNS record** for your hostname
- Create a **Workers route** for `hostname/*`

### Domain constraints (important)

The bootstrap CLI can only fully automate domains that are:

- **Subdomains of a Cloudflare DNS zone you control**, e.g. `media.example.com` where `example.com` is a zone in your Cloudflare account.
- **On Cloudflare DNS** (so the CLI can create a proxied DNS record and Cloudflare can serve traffic to your Worker).

It will **not** automatically work for:

- **Arbitrary external/customer domains** you don’t control in your Cloudflare account (that typically requires Cloudflare for SaaS “custom hostnames” + domain control validation).
- **Zone apex hostnames** like `example.com` (use a subdomain such as `media.example.com`).

### Required token permissions

Create a Cloudflare API token with permissions to manage:

- R2 (bucket create/read)
- Workers (script upload, secrets)
- Zone DNS (DNS record create/read)
- Workers routes (create/read/update)

### Run bootstrap

```bash
export CLOUDFLARE_API_TOKEN="..."
export MEDIA_SIGNING_SECRET="..." # optional; if missing you will be prompted

npx filecel-r2 bootstrap \
  --account "$R2_ACCOUNT_ID" \
  --zone "example.com" \
  --hostname "media.example.com" \
  --bucket "my-media" \
  --worker "media-proxy"
```

The command prints a JSON summary including `baseUrl` (use it as `publicBaseUrl`).

### Create a DNS zone (optional)

If you *don’t* already have the zone in Cloudflare, you can create it via the CLI:

```bash
export CLOUDFLARE_API_TOKEN="..."

npx filecel-r2 zone create \
  --account "$R2_ACCOUNT_ID" \
  --name "example.com" \
  --type full
```

## Requirements

- Node.js **18+**
- A Cloudflare R2 bucket + API token (S3-compatible keys)
- (Optional) A custom domain and a Cloudflare Worker if you want private delivery

## Install

```bash
npm install @filecel/r2
```

## Quickstart (public delivery)

```ts
import { createR2Client } from "@filecel/r2";

const r2 = createR2Client({
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: process.env.R2_BUCKET!,
  publicBaseUrl: "https://media.example.com"
});

const result = await r2.uploadFromUrl("https://example.com/file.webp", {
  key: "users/123/images/2f1d4f3b.webp",
  metadata: {
    userId: "123",
    source: "example.com"
  }
});

console.log(result.publicUrl ?? r2.getPublicUrl(result.key));
```

## Cloudflare R2 setup (S3-compatible)

### 1) Create a bucket

- Create an R2 bucket in the Cloudflare dashboard.
- Decide **public** vs **private**:
  - **Public**: you can serve objects directly (or via a custom domain) without signing.
  - **Private**: you typically serve through a Worker that authorizes and proxies the object.

### 2) Create R2 API credentials

Create **R2 API tokens / S3 credentials** (Access Key ID + Secret Access Key).

You will use:

- `R2_ACCOUNT_ID` (Cloudflare account ID)
- `R2_BUCKET` (bucket name)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### 3) Decide your serving base URL

Set `publicBaseUrl` to the domain that will serve objects:

- If public + custom domain: `https://media.example.com`
- If private + Worker: the Worker route, e.g. `https://media.example.com` (same idea)

This package’s `getPublicUrl(key)` / `getSignedUrl(key, ...)` simply return a URL under that base.

## Recommended key strategy

You generally want keys to be:

- Predictably organized (easy to list by prefix)
- Not guessable if served publicly (use UUIDs)

Example:

```ts
import { createKey } from "@filecel/r2";

const key = createKey({ userId: "123", kind: "images", ext: "webp" });
// users/123/images/<uuid>.webp
```

Or supply your own `key` in `uploadFromUrl(...)`.

## Uploading from an expiring provider URL

### Streaming vs buffer mode

`uploadFromUrl` will choose:

- **Buffer mode** when `content-length` is present and `<= bufferThresholdBytes` (default 8 MiB).
- **Streaming mode** otherwise (including unknown sizes).

### Content-Type detection

- Prefer `Content-Type` response header (charset stripped).
- If missing, sniff the first bytes (without buffering the whole stream) and set `ContentType` on the R2 object.

### Validation

You can reject early / mid-stream:

```ts
await r2.uploadFromUrl(providerUrl, {
  allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
  maxBytes: 10 * 1024 * 1024
});
```

### Metadata tagging

Metadata becomes `x-amz-meta-*` on the object:

```ts
await r2.uploadFromUrl(providerUrl, {
  metadata: {
    userId: "123",
    source: "some-provider",
    createdAt: new Date().toISOString()
  }
});
```

### Retries & timeouts

`uploadFromUrl` retries:

- Fetch failures on transient network errors and retryable statuses (e.g. **429**, **5xx**).

Configure:

```ts
await r2.uploadFromUrl(providerUrl, {
  fetchMaxAttempts: 3,
  uploadMaxAttempts: 2,
  fetchTimeoutMs: 15_000,
  overallTimeoutMs: 120_000
});
```

### Any provider URL + custom fetch options

If your provider requires specific request options (headers, redirect policy, etc.), pass `fetchInit`:

```ts
await r2.uploadFromUrl("https://example.com/file.webp", {
  fetchInit: {
    redirect: "follow",
    headers: {
      "user-agent": "my-app/1.0"
    }
  }
});
```

## Transform pipeline

After the original object is uploaded, you can generate **variant files** in R2 (eager pipeline at upload time).

### Dependencies

- **Images (resize)**: install [`sharp`](https://sharp.pixelplumbing.com/) as a peer dependency:

```bash
npm install sharp
```

- **Videos (transcode)**: requires `ffmpeg` on `PATH`, or set `FFMPEG_PATH` to a binary. Optionally install [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static).

### Example: image resize

```ts
const result = await r2.uploadFromUrl(providerUrl, {
  key: createKey({ userId: "123", kind: "images", ext: "webp" }),
  transforms: [
    { type: "resize", width: 800, format: "webp" },
    { type: "resize", width: 200, height: 200, fit: "cover", format: "webp" }
  ]
});

console.log(result.key); // original
console.log(result.variants); // [{ key: ".../variants/w800.webp", ... }, ...]
```

### Transform options

| Type | Fields | Notes |
|------|--------|-------|
| `resize` | `width?`, `height?`, `fit?`, `format?`, `quality?` | Requires `image/*` content type. At least one of `width`/`height`. Default format: `webp`, quality: `80`. |
| `transcode` | `width?`, `height?`, `videoCodec?`, `audioCodec?`, `format?`, `crf?` | Requires `video/*` content type. Default format: `mp4`, CRF: `23`. |

Variant keys are deterministic, e.g. `users/123/images/uuid/variants/w800.webp`.

Additional options on `uploadFromUrl`:

- `transformErrorMode`: `"fail"` (default) or `"skip"` failed transforms
- `variantKeyStrategy`: custom function to derive variant keys

Transforms add latency proportional to file size. For large videos, increase `overallTimeoutMs`.

## Management API

```ts
await r2.delete(key);

const { items, nextCursor } = await r2.list({ prefix: `users/${userId}/`, limit: 100 });

await r2.copy({ fromKey: "drafts/a.webp", toKey: "users/123/images/a.webp" });
await r2.move({ fromKey: "drafts/a.webp", toKey: "users/123/images/a.webp" });

const head = await r2.head(key); // null if missing
```

## Private delivery (Worker-signed URLs)

This package supports generating signed URLs for a **Cloudflare Worker** sitting in front of an R2 bucket.

The client can generate a signed URL:

```ts
const url = await r2.getSignedUrl("users/123/images/abc.webp", {
  expiresIn: 3600,
  secret: process.env.MEDIA_SIGNING_SECRET!
});
```

### How signing works

- The URL includes query parameters:
  - `exp`: unix timestamp (seconds) when the URL expires
  - `sig`: HMAC-SHA256 hex signature
  - optional `salt`: included in signature payload
- Signature payload format (must match Worker):

```txt
<key>\n<exp>\n<salt>
```

### Reference Worker (HMAC)

This is a minimal Worker that validates `exp` + `sig` and serves from an R2 binding named `BUCKET`.

```ts
export default {
  async fetch(req: Request, env: { BUCKET: R2Bucket; MEDIA_SIGNING_SECRET: string }) {
    const url = new URL(req.url);
    const key = url.pathname.replace(/^\/+/, "");

    const exp = Number(url.searchParams.get("exp") ?? "");
    const sig = url.searchParams.get("sig") ?? "";
    const salt = url.searchParams.get("salt") ?? "";

    if (!Number.isFinite(exp) || !sig) return new Response("Unauthorized", { status: 401 });
    if (Date.now() / 1000 > exp) return new Response("Expired", { status: 401 });

    const payload = `${key}\n${exp}\n${salt}`;
    const expected = await hmacSha256Hex(env.MEDIA_SIGNING_SECRET, payload);
    if (expected !== sig) return new Response("Unauthorized", { status: 401 });

    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    return new Response(obj.body, { headers });
  }
};

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

### Worker setup checklist

- Bind your R2 bucket to the Worker as `BUCKET`.
- Add a secret `MEDIA_SIGNING_SECRET` (same value used by your app when calling `getSignedUrl`).
- Put the Worker on a route (e.g. `media.example.com/*`).
- Keep the bucket private; only the Worker should access it.

## Production notes

- **Provider URLs expire**: upload as soon as possible and keep fetch retries modest.
- **Large videos**: prefer streaming (default). Consider increasing `overallTimeoutMs`.
- **Security**:
  - Treat `R2_SECRET_ACCESS_KEY` and `MEDIA_SIGNING_SECRET` as secrets.
  - If you serve publicly, keys are guessable unless you use UUIDs.
- **Idempotency**:
  - You can pass `idempotencyKey` and implement a deterministic `defaultKeyStrategy` to avoid duplicates.

## Troubleshooting

- **Wrong Content-Type when serving**
  - Ensure the origin response sends a correct `Content-Type`, or allow sniffing (default).
- **Uploads fail intermittently**
  - Increase `fetchMaxAttempts`, `fetchTimeoutMs`, and `overallTimeoutMs`.
  - Ensure your server can reach the provider URL from your runtime.
- **Signed URLs rejected by Worker**
  - Confirm the payload format and that both sides share the same `MEDIA_SIGNING_SECRET`.
  - Ensure the Worker uses the raw path key without leading slashes.

## Publishing to npm (GitHub Actions)

This repo is configured to publish to npm automatically when you push a semver tag like `v0.1.1`.

### One-time setup

1. Create an npm automation token with permission to publish `@filecel/r2`.
2. Add it to GitHub as an Actions secret named `NPM_TOKEN`.

### Release steps

1. Update `package.json` version to the release version (e.g. `0.1.1`) and merge to your default branch.
2. Create and push a matching tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions will run `[.github/workflows/publish.yml](.github/workflows/publish.yml)` and publish the package to npm.


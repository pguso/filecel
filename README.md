# filecel

Monorepo for persisting expiring remote media URLs into Cloudflare R2.

## Packages

| Package | Description |
|---------|-------------|
| [`@filecel/r2`](packages/r2/) | Stream remote URLs into Cloudflare R2 (library + bootstrap CLI) |
| [`@filecel/worker`](apps/worker/) | BullMQ worker service: Replicate URL → R2 → Supabase |

## Quick start

```bash
npm ci
npm run build
npm test
```

## Worker deployment

See [`apps/worker/README.md`](apps/worker/README.md) for VPS/Docker deployment.

## Library usage

See [`packages/r2/README.md`](packages/r2/README.md).

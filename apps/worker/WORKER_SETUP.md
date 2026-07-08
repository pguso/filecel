Ubuntu VPS to GitHub Actions Worker Deployment

What you are deploying

The [@filecel/worker](apps/worker/) service is a single Node process that:





Exposes an HTTP API on port 3000



Uses Redis (BullMQ) for job queuing



Downloads media from a sourceUrl, uploads to Cloudflare R2, and notifies Frameuniverse via webhook

flowchart LR
  Postman -->|"GET /health"| Worker
  Postman -->|"POST /jobs/persist-media"| Worker
  Worker --> Redis
  Worker --> R2
  Worker --> Frameuniverse

Recommended path: Docker Compose on the VPS (matches the commented deploy job in [.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml)). For Postman testing, expose port 3000 directly first; add Caddy/nginx + TLS later.



Phase 1 — VPS bootstrap (one-time)

SSH into your Ubuntu VPS as root or a sudo user.

1.1 System packages and firewall

sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates ufw
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp   # for Postman testing
sudo ufw enable

1.2 Install Docker + Compose plugin

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in so docker group applies
docker --version
docker compose version

1.3 Create deploy user and app directory

sudo mkdir -p /opt/filecel
sudo chown $USER:$USER /opt/filecel

1.4 Clone the repo

cd /opt/filecel
git clone git@github.com:<your-org>/filecel.git .
# or: git clone https://github.com/<your-org>/filecel.git .

If using SSH deploy from GitHub Actions, add a deploy key to the repo (read-only) and place the private key on the VPS at ~/.ssh/id_ed25519 (or configure git to use a specific key). The VPS must be able to git pull without prompts.

1.5 Configure runtime environment

Create [apps/worker/.env](apps/worker/.env.example) on the VPS (never commit this file):

cp apps/worker/.env.example apps/worker/.env
nano apps/worker/.env

Fill in all required values from [.env.example](apps/worker/.env.example):







Variable



Source





WORKER_API_SECRET



Generate: openssl rand -hex 32 — use this in Postman Authorization header





R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET



Cloudflare R2 dashboard





FRAMEUNIVERSE_API_URL, FILECEL_WEBHOOK_SECRET



Frameuniverse API base URL and webhook bearer secret

REDIS_URL is overridden by docker-compose.yml to redis://redis:6379 — you do not need to change it for Compose.

1.6 First manual start (verify before CI)

cd /opt/filecel
docker compose -f apps/worker/docker-compose.yml up -d --build
docker compose -f apps/worker/docker-compose.yml ps
docker compose -f apps/worker/docker-compose.yml logs -f worker

Smoke test from your laptop:

curl http://<VPS_IP>:3000/health
# expected: {"status":"ok"}

If this fails, check: firewall (ufw status), container logs, and that .env has all required vars (startup throws on missing vars — see [config.ts](apps/worker/src/config.ts)).



Phase 2 — Frameuniverse webhook (required for job completion)

The worker no longer writes to Supabase directly. On successful persist it POSTs to `{FRAMEUNIVERSE_API_URL}/webhooks/filecel` with the R2 key and metadata. On final failure it POSTs `{ generationId, error }`.

Frameuniverse must implement the webhook handler to validate authorization, insert assets, presign URLs, and update generation status.

Use a real, publicly reachable image URL as `sourceUrl` when testing (e.g. a stable https:// test image).



Phase 3 — Enable GitHub Actions deploy

Today [.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml) only builds and smoke-tests locally on the runner — the deploy job is commented out and no image is pushed to a registry. The intended flow is SSH to VPS + git pull + rebuild via Compose.

3.1 Add GitHub repository secrets

In GitHub → Settings → Secrets and variables → Actions, add:







Secret



Value





VPS_HOST



VPS public IP or hostname





VPS_USER



SSH user (e.g. ubuntu or your deploy user)





VPS_SSH_KEY



Private key that can SSH to the VPS (ed25519 recommended)

Generate a dedicated deploy key pair; add the public key to ~/.ssh/authorized_keys on the VPS.

3.2 Uncomment the deploy job

In [.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml), uncomment lines 38–55 (the deploy job). Optionally harden the smoke test in the same PR:





Remove || true so startup failures fail CI



Add a Redis service container and curl -f http://localhost:3000/health

Resulting deploy flow:

sequenceDiagram
  participant GHA as GitHubActions
  participant VPS as UbuntuVPS
  GHA->>GHA: build-image + smoke test
  GHA->>VPS: SSH deploy script
  VPS->>VPS: cd /opt/filecel && git pull
  VPS->>VPS: docker compose up -d --build

3.3 Trigger a deploy

The workflow runs on:





Push to main touching apps/worker/**, packages/r2/**, or package-lock.json



Manual workflow_dispatch from the Actions tab

After merge, confirm on VPS:

docker compose -f apps/worker/docker-compose.yml ps
docker compose -f apps/worker/docker-compose.yml logs --tail=50 worker



Phase 4 — Postman manual test plan

Base URL: http://<VPS_IP>:3000

Request 1 — Health check (no auth)





GET /health



Expected 200: { "status": "ok" }

Request 2 — Unauthorized (sanity check)





POST /jobs/persist-media with no Authorization header



Expected 401: { "error": "Unauthorized" }

Request 3 — Enqueue persist job





POST /jobs/persist-media



Headers:





Authorization: Bearer <WORKER_API_SECRET>



Content-Type: application/json



Body:

{
  "userId": "22222222-2222-2222-2222-222222222222",
  "generationId": "11111111-1111-1111-1111-111111111111",
  "projectId": "33333333-3333-3333-3333-333333333333",
  "sourceUrl": "https://picsum.photos/800/600",
  "kind": "images",
  "filename": "test-image.jpg"
}





Expected 202:

{
  "jobId": "persist-media-11111111-1111-1111-1111-111111111111",
  "status": "queued",
  "duplicate": false
}

Request 4 — Verify job completed

After a few seconds, check:





VPS logs: docker compose -f apps/worker/docker-compose.yml logs worker



Supabase generations: status → COMPLETED, output_url → R2 URL



Supabase assets: new row with storage_url



R2 bucket: object exists at expected key path

Common failure modes







Symptom



Likely cause





Connection refused



UFW blocking 3000, or containers not running





401



Wrong WORKER_API_SECRET in Postman





400



Missing fields or invalid sourceUrl





202 but job fails in logs



Bad R2 creds, unreachable sourceUrl, missing generation row, ownership mismatch





Deploy SSH fails



Wrong VPS_SSH_KEY, user lacks docker permissions, git pull auth failure



Phase 5 — Optional hardening (after manual testing works)





TLS: Put Caddy or nginx in front of port 3000 with a domain + Let's Encrypt; update Postman base URL to https://worker.yourdomain.com



Restrict access: Firewall to your IP only, or allow Vercel egress IPs if wiring a calling app



Monitoring: Add a cron or uptime check hitting /health



Registry-based deploy: Push image to GHCR and docker pull on VPS instead of on-box --build (faster deploys, but requires workflow changes beyond uncommenting)



Repo changes needed (summary)

Only one workflow change is required to automate deploy:





Uncomment the deploy job in [.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml)



(Recommended) Strengthen the build-image smoke test

Everything else is VPS + GitHub secrets + Supabase setup — no application code changes required.

Checklist





VPS: Docker, firewall, /opt/filecel clone



VPS: apps/worker/.env with real R2 + Supabase + secret



VPS: docker compose up -d --build succeeds; curl /health returns ok



Supabase: generations + assets tables + test generation row



GitHub: VPS_HOST, VPS_USER, VPS_SSH_KEY secrets set



Repo: deploy job uncommented in workflow



Postman: health, 401, enqueue 202, verify Supabase/R2 after job runs


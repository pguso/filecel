#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import process from "node:process";

import { CloudflareClient } from "./cloudflare.js";
import { BootstrapError, BootstrapValidationError } from "./errors.js";
import { parseCliArgv } from "./parseCliArgv.js";
import { getWorkerModuleSource } from "./workerTemplate.js";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  return v.trim() || undefined;
}

async function promptSecret(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const v = (await rl.question(prompt)).trim();
    if (!v) throw new BootstrapValidationError("Secret cannot be empty.");
    return v;
  } finally {
    rl.close();
  }
}

function printUsage(): void {
  // Keep this short; README will have full docs.
  console.log(`Usage:
  filecel-r2 bootstrap --account <accountId> --zone <example.com> --hostname <media.example.com> --bucket <bucket> --worker <scriptName> [--dry-run] [--skip-dns]
  filecel-r2 zone create --account <accountId> --name <example.com> [--type full|partial] [--jump-start] [--dry-run]
Env:
  CLOUDFLARE_API_TOKEN  (required)
  MEDIA_SIGNING_SECRET  (optional; prompted if missing)
`);
}

async function run(): Promise<void> {
  const parsed = parseCliArgv(process.argv.slice(2));
  if (!parsed.ok) {
    printUsage();
    process.exit(parsed.reason === "help" ? 0 : 1);
  }

  const apiToken = readEnv("CLOUDFLARE_API_TOKEN");
  if (!apiToken) throw new BootstrapValidationError("CLOUDFLARE_API_TOKEN is required.");

  const cf = new CloudflareClient({ apiToken });

  if (parsed.cmd.command === "zone_create") {
    const args = parsed.cmd.args;
    const res = await cf.createZone({
      accountId: args.account,
      name: args.name,
      type: args.type,
      jumpStart: args.jumpStart,
      dryRun: args.dryRun
    });

    console.log(
      JSON.stringify(
        {
          dryRun: args.dryRun,
          zone: { id: res.id, name: res.name, type: res.type }
        },
        null,
        2
      )
    );
    return;
  }

  const args = parsed.cmd.args;

  const zoneId = await cf.getZoneIdByName(args.zone);

  const bucketRes = await cf.ensureBucket({
    accountId: args.account,
    bucketName: args.bucket,
    locationHint: args.locationHint,
    dryRun: args.dryRun
  });

  const moduleName = "worker.js";
  const workerSource = getWorkerModuleSource({ bindingName: "BUCKET", secretBindingName: "MEDIA_SIGNING_SECRET" });
  const compatibilityDate = new Date().toISOString().slice(0, 10);

  const metadata = {
    main_module: moduleName,
    compatibility_date: compatibilityDate,
    bindings: [
      {
        name: "BUCKET",
        type: "r2_bucket",
        bucket_name: args.bucket
      }
    ]
  };

  await cf.uploadWorkerModule({
    accountId: args.account,
    scriptName: args.worker,
    moduleName,
    moduleContent: workerSource,
    metadata,
    dryRun: args.dryRun
  });

  const signingSecret = readEnv("MEDIA_SIGNING_SECRET") ?? (await promptSecret("MEDIA_SIGNING_SECRET: "));
  await cf.putWorkerSecret({
    accountId: args.account,
    scriptName: args.worker,
    name: "MEDIA_SIGNING_SECRET",
    text: signingSecret,
    dryRun: args.dryRun
  });

  let dnsCreated: boolean | undefined;
  if (!args.skipDns) {
    const dnsRes = await cf.ensureDnsForHostname({
      zoneId,
      zoneName: args.zone,
      hostname: args.hostname,
      dryRun: args.dryRun
    });
    dnsCreated = dnsRes.created;
  }

  const routeRes = await cf.ensureWorkerRoute({
    zoneId,
    pattern: args.routePattern,
    script: args.worker,
    dryRun: args.dryRun
  });

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        zoneId,
        bucket: { name: args.bucket, created: bucketRes.created },
        worker: { name: args.worker, uploaded: true },
        dns: args.skipDns ? { skipped: true } : { created: dnsCreated ?? false },
        route: { pattern: args.routePattern, created: routeRes.created, updated: routeRes.updated },
        baseUrl: `https://${args.hostname}`
      },
      null,
      2
    )
  );
}

run().catch((err: unknown) => {
  const e = err as Error;
  const message =
    err instanceof BootstrapError ? e.message : `Unexpected error: ${e?.message ?? String(err)}`;
  console.error(message);
  process.exit(1);
});


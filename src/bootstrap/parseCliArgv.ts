import { parseArgs } from "node:util";

import { BootstrapValidationError } from "./errors.js";

export type BootstrapCliArgs = {
  account: string;
  zone: string;
  hostname: string;
  bucket: string;
  worker: string;
  routePattern: string;
  locationHint?: string;
  dryRun: boolean;
  skipDns: boolean;
};

export type ZoneCreateCliArgs = {
  account: string;
  name: string;
  type: "full" | "partial";
  jumpStart: boolean;
  dryRun: boolean;
};

export type CliCommand =
  | { command: "bootstrap"; args: BootstrapCliArgs }
  | { command: "zone_create"; args: ZoneCreateCliArgs };

export type ParseCliArgvResult =
  | { ok: true; cmd: CliCommand }
  | { ok: false; reason: "help" | "invalid_command" };

export function parseCliArgv(argv: string[]): ParseCliArgvResult {
  const cmd1 = argv[0];
  const cmd2 = argv[1];

  // Shared: allow `--help` anywhere.
  if (argv.includes("--help") || argv.includes("-h")) return { ok: false, reason: "help" };

  if (cmd1 === "bootstrap") {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        account: { type: "string" },
        zone: { type: "string" },
        hostname: { type: "string" },
        bucket: { type: "string" },
        worker: { type: "string" },
        "route-pattern": { type: "string" },
        "location-hint": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "skip-dns": { type: "boolean", default: false }
      }
    });

    // positionals[0] is "bootstrap"
    if (positionals[0] !== "bootstrap") return { ok: false, reason: "invalid_command" };

    const account = values.account?.trim() ?? "";
    const zone = values.zone?.trim() ?? "";
    const hostname = values.hostname?.trim() ?? "";
    const bucket = values.bucket?.trim() ?? "";
    const worker = values.worker?.trim() ?? "";
    const routePattern = (values["route-pattern"]?.trim() ?? `${hostname}/*`).trim();

    if (!account) throw new BootstrapValidationError("--account is required.");
    if (!zone) throw new BootstrapValidationError("--zone is required.");
    if (!hostname) throw new BootstrapValidationError("--hostname is required.");
    if (!bucket) throw new BootstrapValidationError("--bucket is required.");
    if (!worker) throw new BootstrapValidationError("--worker is required.");

    return {
      ok: true,
      cmd: {
        command: "bootstrap",
        args: {
          account,
          zone,
          hostname,
          bucket,
          worker,
          routePattern,
          locationHint: values["location-hint"]?.trim(),
          dryRun: Boolean(values["dry-run"]),
          skipDns: Boolean(values["skip-dns"])
        }
      }
    };
  }

  if (cmd1 === "zone" && cmd2 === "create") {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        account: { type: "string" },
        name: { type: "string" },
        type: { type: "string" },
        "jump-start": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false }
      }
    });

    if (positionals[0] !== "zone" || positionals[1] !== "create") {
      return { ok: false, reason: "invalid_command" };
    }

    const account = values.account?.trim() ?? "";
    const name = values.name?.trim() ?? "";
    const typeRaw = (values.type?.trim() ?? "full") as string;
    const type = typeRaw === "partial" ? "partial" : "full";

    if (!account) throw new BootstrapValidationError("--account is required.");
    if (!name) throw new BootstrapValidationError("--name is required.");

    return {
      ok: true,
      cmd: {
        command: "zone_create",
        args: {
          account,
          name,
          type,
          jumpStart: Boolean(values["jump-start"]),
          dryRun: Boolean(values["dry-run"])
        }
      }
    };
  }

  return { ok: false, reason: "invalid_command" };
}


import { describe, expect, it } from "vitest";

import { parseBootstrapArgv } from "../src/bootstrap/parseBootstrapArgv.js";
import { parseCliArgv } from "../src/bootstrap/parseCliArgv.js";
import { BootstrapValidationError } from "../src/bootstrap/errors.js";

describe("parseBootstrapArgv", () => {
  it("parses required bootstrap flags", () => {
    const parsed = parseBootstrapArgv([
      "bootstrap",
      "--account",
      "acc1",
      "--zone",
      "example.com",
      "--hostname",
      "media.example.com",
      "--bucket",
      "my-bucket",
      "--worker",
      "media-proxy"
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.args).toEqual({
      account: "acc1",
      zone: "example.com",
      hostname: "media.example.com",
      bucket: "my-bucket",
      worker: "media-proxy",
      routePattern: "media.example.com/*",
      locationHint: undefined,
      dryRun: false,
      skipDns: false
    });
  });

  it("returns help when --help is passed", () => {
    const parsed = parseBootstrapArgv(["bootstrap", "--help"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected not ok");
    expect(parsed.reason).toBe("help");
  });

  it("returns invalid_command when command is not bootstrap", () => {
    const parsed = parseBootstrapArgv(["other"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected not ok");
    expect(parsed.reason).toBe("invalid_command");
  });

  it("respects route-pattern, dry-run, skip-dns, location-hint", () => {
    const parsed = parseBootstrapArgv([
      "bootstrap",
      "--account",
      "a",
      "--zone",
      "z.com",
      "--hostname",
      "h.com",
      "--bucket",
      "b",
      "--worker",
      "w",
      "--route-pattern",
      "custom.example/*",
      "--dry-run",
      "--skip-dns",
      "--location-hint",
      "wnam"
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.args.routePattern).toBe("custom.example/*");
    expect(parsed.args.dryRun).toBe(true);
    expect(parsed.args.skipDns).toBe(true);
    expect(parsed.args.locationHint).toBe("wnam");
  });

  it("throws BootstrapValidationError when account is missing", () => {
    expect(() =>
      parseBootstrapArgv(["bootstrap", "--zone", "z", "--hostname", "h", "--bucket", "b", "--worker", "w"])
    ).toThrow(BootstrapValidationError);
  });

  it("parses zone create", () => {
    const parsed = parseCliArgv(["zone", "create", "--account", "acc1", "--name", "example.com"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.cmd).toEqual({
      command: "zone_create",
      args: { account: "acc1", name: "example.com", type: "full", jumpStart: false, dryRun: false }
    });
  });
});

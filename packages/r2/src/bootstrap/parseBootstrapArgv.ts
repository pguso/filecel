import type { BootstrapCliArgs } from "./parseCliArgv.js";
import { parseCliArgv } from "./parseCliArgv.js";

export type ParseBootstrapArgvResult =
  | { ok: true; args: BootstrapCliArgs }
  | { ok: false; reason: "help" | "invalid_command" };

/**
 * Back-compat helper for the legacy `bootstrap` parser.
 * New code should use `parseCliArgv`.
 */
export function parseBootstrapArgv(argv: string[]): ParseBootstrapArgvResult {
  const parsed = parseCliArgv(argv);
  if (!parsed.ok) return parsed;
  if (parsed.cmd.command !== "bootstrap") return { ok: false, reason: "invalid_command" };
  return { ok: true, args: parsed.cmd.args };
}

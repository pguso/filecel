import { withRetry } from "../retry/withRetry.js";
import { BootstrapValidationError, CloudflareApiError } from "./errors.js";

type CfMessage = { code?: number; message?: string };
type CfError = { code?: number; message?: string };
type CfResponse<T> = {
  success: boolean;
  errors?: CfError[];
  messages?: CfMessage[];
  result?: T;
  result_info?: unknown;
};

function getRequestId(res: Response): string | undefined {
  return res.headers.get("cf-ray") ?? res.headers.get("x-request-id") ?? undefined;
}

async function readBodyTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function isRetryableStatus(status: number): boolean {
  if (status === 408) return true;
  if (status === 409) return true;
  if (status === 425) return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}

function assertOkHostname(hostname: string, zoneName: string): void {
  if (!hostname) throw new BootstrapValidationError("hostname is required.");
  if (!zoneName) throw new BootstrapValidationError("zone is required.");
  if (hostname === zoneName) {
    throw new BootstrapValidationError(
      `hostname must be a subdomain, not the zone apex (${hostname}).`
    );
  }
  if (!hostname.endsWith(`.${zoneName}`)) {
    throw new BootstrapValidationError(`hostname (${hostname}) must be within zone (${zoneName}).`);
  }
}

export type CloudflareClientOptions = {
  apiToken: string;
  baseUrl?: string;
  userAgent?: string;
  maxAttempts?: number;
};

export class CloudflareClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxAttempts: number;

  constructor(opts: CloudflareClientOptions) {
    if (!opts.apiToken) throw new BootstrapValidationError("CLOUDFLARE_API_TOKEN is required.");
    this.apiToken = opts.apiToken;
    this.baseUrl = opts.baseUrl ?? "https://api.cloudflare.com/client/v4";
    this.userAgent = opts.userAgent ?? "filecel-r2-bootstrap";
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  }

  private async request<T>(
    method: string,
    path: string,
    init?: { query?: Record<string, string | undefined>; body?: unknown; form?: FormData }
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const doFetch = async (): Promise<T> => {
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${this.apiToken}`);
      headers.set("User-Agent", this.userAgent);

      let body: BodyInit | undefined;
      if (init?.form) {
        body = init.form;
      } else if (init?.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(init.body);
      }

      const res = await fetch(url.toString(), { method, headers, body });
      const requestId = getRequestId(res);
      const contentType = res.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          const text = await readBodyTextSafe(res);
          throw new CloudflareApiError(`Retryable Cloudflare API error ${res.status}.`, {
            status: res.status,
            requestId,
            cause: text ? new Error(text) : undefined
          });
        }
        const text = await readBodyTextSafe(res);
        throw new CloudflareApiError(`Cloudflare API error ${res.status}.`, {
          status: res.status,
          requestId,
          cause: text ? new Error(text) : undefined
        });
      }

      if (!isJson) {
        const text = await res.text();
        // Some endpoints return raw text; expose as unknown/string.
        return text as unknown as T;
      }

      const json = (await res.json()) as CfResponse<T>;
      if (!json.success) {
        const code = json.errors?.[0]?.code;
        const msg = json.errors?.[0]?.message ?? "Cloudflare API returned success=false.";
        throw new CloudflareApiError(msg, { status: res.status, code, requestId, cause: json });
      }
      return (json.result ?? (undefined as unknown as T)) as T;
    };

    return await withRetry(() => doFetch(), {
      maxAttempts: this.maxAttempts,
      retryOn: (err) => {
        if (err instanceof CloudflareApiError) return isRetryableStatus(err.status);
        const anyErr = err as { name?: string };
        if (anyErr?.name === "AbortError") return false;
        return true;
      }
    });
  }

  async getZoneIdByName(zoneName: string): Promise<string> {
    const res = await this.request<Array<{ id: string; name: string }>>("GET", "/zones", {
      query: { name: zoneName }
    });
    const zone = res.find((z) => z.name === zoneName);
    if (!zone) throw new BootstrapValidationError(`Zone not found: ${zoneName}`);
    return zone.id;
  }

  async createZone(params: {
    accountId: string;
    name: string;
    type: "full" | "partial";
    jumpStart?: boolean;
    dryRun?: boolean;
  }): Promise<{ id: string; name: string; type: "full" | "partial" }> {
    const name = params.name.trim();
    if (!name) throw new BootstrapValidationError("--name is required.");
    if (!params.accountId) throw new BootstrapValidationError("--account is required.");

    if (params.dryRun) {
      return { id: "dry_run_zone_id", name, type: params.type };
    }

    const zone = await this.request<{ id: string; name: string; type: "full" | "partial" }>("POST", "/zones", {
      body: {
        name,
        type: params.type,
        jump_start: Boolean(params.jumpStart),
        account: { id: params.accountId }
      }
    });
    return zone;
  }

  async bucketExists(accountId: string, bucketName: string): Promise<boolean> {
    try {
      await this.request<{ name: string }>("GET", `/accounts/${accountId}/r2/buckets/${bucketName}`);
      return true;
    } catch (err) {
      if (err instanceof CloudflareApiError && err.status === 404) return false;
      throw err;
    }
  }

  async createBucket(accountId: string, bucketName: string, locationHint?: string): Promise<void> {
    const body: Record<string, unknown> = { name: bucketName };
    if (locationHint) body.locationHint = locationHint;
    await this.request("POST", `/accounts/${accountId}/r2/buckets`, { body });
  }

  async ensureBucket(params: {
    accountId: string;
    bucketName: string;
    locationHint?: string;
    dryRun?: boolean;
  }): Promise<{ created: boolean }> {
    const exists = await this.bucketExists(params.accountId, params.bucketName);
    if (exists) return { created: false };
    if (params.dryRun) return { created: true };
    await this.createBucket(params.accountId, params.bucketName, params.locationHint);
    return { created: true };
  }

  async uploadWorkerModule(params: {
    accountId: string;
    scriptName: string;
    moduleName: string;
    moduleContent: string;
    metadata: unknown;
    dryRun?: boolean;
  }): Promise<void> {
    if (params.dryRun) return;

    const form = new FormData();
    form.append("metadata", JSON.stringify(params.metadata));
    form.append(
      params.moduleName,
      new Blob([params.moduleContent], { type: "application/javascript+module" }),
      params.moduleName
    );

    await this.request("PUT", `/accounts/${params.accountId}/workers/scripts/${params.scriptName}`, {
      form
    });
  }

  async putWorkerSecret(params: {
    accountId: string;
    scriptName: string;
    name: string;
    text: string;
    dryRun?: boolean;
  }): Promise<void> {
    if (params.dryRun) return;
    await this.request("PUT", `/accounts/${params.accountId}/workers/scripts/${params.scriptName}/secrets`, {
      body: { name: params.name, text: params.text, type: "secret_text" }
    });
  }

  async getDnsRecordByName(params: {
    zoneId: string;
    name: string;
  }): Promise<{ id: string; name: string; type: string; content: string; proxied?: boolean } | null> {
    const res = await this.request<
      Array<{ id: string; name: string; type: string; content: string; proxied?: boolean }>
    >("GET", `/zones/${params.zoneId}/dns_records`, { query: { name: params.name } });
    return res[0] ?? null;
  }

  async createDnsRecord(params: {
    zoneId: string;
    type: "CNAME" | "A";
    name: string;
    content: string;
    proxied: boolean;
    dryRun?: boolean;
  }): Promise<void> {
    if (params.dryRun) return;
    await this.request("POST", `/zones/${params.zoneId}/dns_records`, {
      body: {
        type: params.type,
        name: params.name,
        content: params.content,
        proxied: params.proxied
      }
    });
  }

  async ensureDnsForHostname(params: {
    zoneId: string;
    zoneName: string;
    hostname: string;
    dryRun?: boolean;
  }): Promise<{ created: boolean; recordType: "CNAME"; content: string }> {
    assertOkHostname(params.hostname, params.zoneName);
    const existing = await this.getDnsRecordByName({ zoneId: params.zoneId, name: params.hostname });
    if (existing) {
      return { created: false, recordType: "CNAME", content: existing.content };
    }
    const content = params.zoneName;
    await this.createDnsRecord({
      zoneId: params.zoneId,
      type: "CNAME",
      name: params.hostname,
      content,
      proxied: true,
      dryRun: params.dryRun
    });
    return { created: true, recordType: "CNAME", content };
  }

  async listWorkerRoutes(zoneId: string): Promise<Array<{ id: string; pattern: string; script?: string }>> {
    return await this.request("GET", `/zones/${zoneId}/workers/routes`);
  }

  async createWorkerRoute(params: {
    zoneId: string;
    pattern: string;
    script: string;
    dryRun?: boolean;
  }): Promise<void> {
    if (params.dryRun) return;
    await this.request("POST", `/zones/${params.zoneId}/workers/routes`, {
      body: { pattern: params.pattern, script: params.script }
    });
  }

  async updateWorkerRoute(params: {
    zoneId: string;
    routeId: string;
    pattern: string;
    script: string;
    dryRun?: boolean;
  }): Promise<void> {
    if (params.dryRun) return;
    await this.request("PUT", `/zones/${params.zoneId}/workers/routes/${params.routeId}`, {
      body: { pattern: params.pattern, script: params.script }
    });
  }

  async ensureWorkerRoute(params: {
    zoneId: string;
    pattern: string;
    script: string;
    dryRun?: boolean;
  }): Promise<{ created: boolean; updated: boolean }> {
    const routes = await this.listWorkerRoutes(params.zoneId);
    const existing = routes.find((r) => r.pattern === params.pattern);
    if (!existing) {
      await this.createWorkerRoute(params);
      return { created: true, updated: false };
    }
    if ((existing.script ?? "") !== params.script) {
      await this.updateWorkerRoute({
        zoneId: params.zoneId,
        routeId: existing.id,
        pattern: params.pattern,
        script: params.script,
        dryRun: params.dryRun
      });
      return { created: false, updated: true };
    }
    return { created: false, updated: false };
  }
}


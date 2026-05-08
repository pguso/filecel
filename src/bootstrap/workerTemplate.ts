export type WorkerTemplateParams = {
  bindingName?: string;
  secretBindingName?: string;
};

export function getWorkerModuleSource(params: WorkerTemplateParams = {}): string {
  const bindingName = params.bindingName ?? "BUCKET";
  const secretName = params.secretBindingName ?? "MEDIA_SIGNING_SECRET";

  // Keep the signing payload format identical to `src/signedUrl/workerHmac.ts`:
  // `${key}\n${exp}\n${salt ?? ""}`
  return `export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = url.pathname.replace(/^\\/+/, "");

    const exp = Number(url.searchParams.get("exp") ?? "");
    const sig = url.searchParams.get("sig") ?? "";
    const salt = url.searchParams.get("salt") ?? "";

    if (!Number.isFinite(exp) || !sig) return new Response("Unauthorized", { status: 401 });
    if (Date.now() / 1000 > exp) return new Response("Expired", { status: 401 });

    const payload = \`\${key}\\n\${exp}\\n\${salt}\`;
    const expected = await hmacSha256Hex(env.${secretName}, payload);
    if (expected !== sig) return new Response("Unauthorized", { status: 401 });

    const obj = await env.${bindingName}.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    return new Response(obj.body, { headers });
  }
};

async function hmacSha256Hex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
`;
}


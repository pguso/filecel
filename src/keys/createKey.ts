export type KeyKind = "images" | "videos" | "files";

export type KeyInput = {
  userId: string;
  kind: KeyKind;
  ext?: string;
  uuid?: string;
  prefix?: string;
};

export function createKey(input: KeyInput): string {
  const safePrefix = input.prefix ? input.prefix.replace(/^\/+|\/+$/g, "") : "users";
  const id = input.uuid ?? globalThis.crypto.randomUUID();
  const ext = input.ext ? input.ext.replace(/^\./, "") : undefined;
  const filename = ext ? `${id}.${ext}` : id;
  return `${safePrefix}/${encodeURIComponent(input.userId)}/${input.kind}/${filename}`;
}


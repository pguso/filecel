import { describe, expect, it, vi } from "vitest";
import { createKey } from "../src/keys/createKey.js";

describe("createKey", () => {
  it("creates stable path with provided uuid/ext", () => {
    const key = createKey({ userId: "123", kind: "images", uuid: "u", ext: "webp" });
    expect(key).toBe("users/123/images/u.webp");
  });

  it("uses randomUUID when uuid missing", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000000");
    const key = createKey({ userId: "123", kind: "videos", ext: ".mp4" });
    expect(key).toBe("users/123/videos/00000000-0000-0000-0000-000000000000.mp4");
  });
});


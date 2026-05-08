import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRandomUUID = vi.hoisted(() =>
  vi.fn(() => "00000000-0000-0000-0000-000000000000")
);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: mockRandomUUID as unknown as typeof actual.randomUUID
  };
});

import { createKey } from "../src/keys/createKey.js";

describe("createKey", () => {
  beforeEach(() => {
    mockRandomUUID.mockClear();
    mockRandomUUID.mockImplementation(() => "00000000-0000-0000-0000-000000000000");
  });

  it("creates stable path with provided uuid/ext", () => {
    const key = createKey({ userId: "123", kind: "images", uuid: "u", ext: "webp" });
    expect(key).toBe("users/123/images/u.webp");
    expect(mockRandomUUID).not.toHaveBeenCalled();
  });

  it("uses randomUUID when uuid missing", () => {
    const key = createKey({ userId: "123", kind: "videos", ext: ".mp4" });
    expect(key).toBe("users/123/videos/00000000-0000-0000-0000-000000000000.mp4");
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
  });
});


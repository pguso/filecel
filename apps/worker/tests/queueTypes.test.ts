import { describe, expect, it } from "vitest";

import { deriveFilename, persistMediaJobId } from "../src/queue/types.js";

describe("persistMediaJobId", () => {
  it("uses generation id for idempotency", () => {
    expect(
      persistMediaJobId({
        userId: "user-1",
        generationId: "gen-1",
        projectId: "project-1",
        sourceUrl: "https://replicate.delivery/example.png"
      })
    ).toBe("persist-media-gen-1");
  });
});

describe("deriveFilename", () => {
  it("prefers explicit filename", () => {
    expect(
      deriveFilename("https://replicate.delivery/path/file.png", "users/u/images/id", "custom.png")
    ).toBe("custom.png");
  });

  it("falls back to source URL basename", () => {
    expect(
      deriveFilename("https://replicate.delivery/path/file.png", "users/u/images/id")
    ).toBe("file.png");
  });

  it("falls back to storage key basename", () => {
    expect(deriveFilename("not-a-url", "users/u/images/my-file.webp")).toBe("my-file.webp");
  });
});

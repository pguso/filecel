import { describe, expect, it } from "vitest";

import { assetTypeFromKind } from "../src/supabase/assets.js";
import { validateGenerationOwnership, type GenerationRecord } from "../src/supabase/generations.js";
import { deriveFilename, persistMediaJobId } from "../src/queue/types.js";

describe("validateGenerationOwnership", () => {
  const generation: GenerationRecord = {
    id: "gen-1",
    userId: "user-1",
    projectId: "project-1",
    status: "PENDING"
  };

  it("accepts matching user and project", () => {
    expect(() => validateGenerationOwnership(generation, "user-1", "project-1")).not.toThrow();
  });

  it("rejects user mismatch", () => {
    expect(() => validateGenerationOwnership(generation, "user-2", "project-1")).toThrow(
      "does not belong to user"
    );
  });

  it("rejects project mismatch", () => {
    expect(() => validateGenerationOwnership(generation, "user-1", "project-2")).toThrow(
      "does not belong to project"
    );
  });
});

describe("assetTypeFromKind", () => {
  it("maps videos to VIDEO", () => {
    expect(assetTypeFromKind("videos")).toBe("VIDEO");
  });

  it("maps images and files to IMAGE", () => {
    expect(assetTypeFromKind("images")).toBe("IMAGE");
    expect(assetTypeFromKind("files")).toBe("IMAGE");
  });
});

describe("persistMediaJobId", () => {
  it("uses generation id for idempotency", () => {
    expect(
      persistMediaJobId({
        userId: "user-1",
        generationId: "gen-1",
        projectId: "project-1",
        sourceUrl: "https://replicate.delivery/example.png"
      })
    ).toBe("persist-media:gen-1");
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

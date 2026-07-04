import { describe, expect, it } from "vitest";
import { createVariantKey } from "../src/transform/variantKey.js";

describe("createVariantKey", () => {
  it("builds resize variant key with width and format", () => {
    const key = createVariantKey("users/123/images/uuid.webp", {
      type: "resize",
      width: 800,
      format: "webp"
    });
    expect(key).toBe("users/123/images/uuid/variants/w800.webp");
  });

  it("builds resize variant key with width, height, and cover fit", () => {
    const key = createVariantKey("users/123/images/uuid.webp", {
      type: "resize",
      width: 200,
      height: 200,
      fit: "cover",
      format: "webp"
    });
    expect(key).toBe("users/123/images/uuid/variants/w200-h200-c.webp");
  });

  it("builds transcode variant key with width and format", () => {
    const key = createVariantKey("users/123/videos/uuid.mp4", {
      type: "transcode",
      width: 1280,
      format: "mp4"
    });
    expect(key).toBe("users/123/videos/uuid/variants/w1280.mp4");
  });

  it("handles keys without extension", () => {
    const key = createVariantKey("uploads/raw", {
      type: "resize",
      width: 400
    });
    expect(key).toBe("uploads/raw/variants/w400.webp");
  });
});

import { describe, expect, it } from "vitest";

import { getPublicUrl } from "../src/urls/getPublicUrl.js";
import { SigningError } from "../src/errors.js";

describe("getPublicUrl", () => {
  it("throws when publicBaseUrl is missing", () => {
    expect(() => getPublicUrl({ key: "a.webp" })).toThrow(SigningError);
  });

  it("normalizes trailing slash on base URL", () => {
    expect(getPublicUrl({ publicBaseUrl: "https://cdn.example.com/", key: "x.webp" })).toBe(
      "https://cdn.example.com/x.webp"
    );
  });

  it("strips leading slash from key", () => {
    expect(getPublicUrl({ publicBaseUrl: "https://cdn.example.com", key: "/folder/a.webp" })).toBe(
      "https://cdn.example.com/folder/a.webp"
    );
  });

  it("encodeURI keeps path segments safe for spaces and unicode", () => {
    expect(getPublicUrl({ publicBaseUrl: "https://cdn.example.com", key: "my file.webp" })).toBe(
      "https://cdn.example.com/my%20file.webp"
    );
    expect(getPublicUrl({ publicBaseUrl: "https://cdn.example.com", key: "café.png" })).toBe(
      "https://cdn.example.com/caf%C3%A9.png"
    );
  });
});

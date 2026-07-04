import { describe, expect, it } from "vitest";

import { verifyBearerAuth } from "../src/auth.js";

describe("verifyBearerAuth", () => {
  it("accepts a valid bearer token", () => {
    expect(verifyBearerAuth("Bearer secret-token", "secret-token")).toBe(true);
  });

  it("rejects missing or invalid authorization", () => {
    expect(verifyBearerAuth(undefined, "secret-token")).toBe(false);
    expect(verifyBearerAuth("Basic secret-token", "secret-token")).toBe(false);
    expect(verifyBearerAuth("Bearer wrong-token", "secret-token")).toBe(false);
  });
});

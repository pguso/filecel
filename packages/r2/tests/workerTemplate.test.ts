import { describe, expect, it } from "vitest";

import { getWorkerModuleSource } from "../src/bootstrap/workerTemplate.js";

describe("getWorkerModuleSource", () => {
  it("embeds signing payload format consistent with workerHmac.buildSigPayload", () => {
    const src = getWorkerModuleSource();
    expect(src).toContain("`${key}\\n${exp}\\n${salt}`");
    expect(src).toContain("MEDIA_SIGNING_SECRET");
    expect(src).toContain("BUCKET");
  });

  it("allows custom binding names", () => {
    const src = getWorkerModuleSource({ bindingName: "MY_R2", secretBindingName: "SIGN_SECRET" });
    expect(src).toContain("env.MY_R2");
    expect(src).toContain("env.SIGN_SECRET");
  });
});

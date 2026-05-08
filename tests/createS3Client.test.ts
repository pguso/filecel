import { describe, expect, it } from "vitest";

import { createS3Client } from "../src/client/s3.js";

describe("createS3Client", () => {
  it("uses default R2 endpoint from account id and auto region", async () => {
    const client = createS3Client({
      accountId: "acc123",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s"
    });

    expect(await client.config.region()).toBe("auto");
    expect(client.config.forcePathStyle).toBe(true);
    const credentials = await client.config.credentials();
    expect(credentials.accessKeyId).toBe("k");
    expect(credentials.secretAccessKey).toBe("s");

    const resolvedEndpoint = await client.config.endpoint?.();
    expect(JSON.stringify(resolvedEndpoint)).toContain("acc123.r2.cloudflarestorage.com");
  });

  it("allows custom endpoint override", async () => {
    const client = createS3Client({
      accountId: "acc",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      endpoint: "http://localhost:9000",
      region: "us-east-1"
    });

    expect(await client.config.region()).toBe("us-east-1");
    const resolvedEndpoint = await client.config.endpoint?.();
    const endpointJson = JSON.stringify(resolvedEndpoint);
    expect(endpointJson).toContain('"hostname":"localhost"');
    expect(endpointJson).toContain('"port":9000');
  });
});

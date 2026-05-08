import http from "node:http";
import type { AddressInfo } from "node:net";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createR2ClientFromS3 } from "../../src/client/createR2Client.js";

const PNG_1X1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const endpoint = process.env.LOCALSTACK_ENDPOINT ?? "http://127.0.0.1:4566";
const bucket = "test-bucket-integration";

describe.skipIf(process.env.RUN_INTEGRATION !== "1")("LocalStack S3 uploadFromUrl", () => {
  let s3: S3Client;

  beforeAll(async () => {
    s3 = new S3Client({
      endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      forcePathStyle: true
    });
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
  });

  afterAll(() => {
    s3.destroy();
  });

  it("uploads a buffered PNG from a local HTTP URL", async () => {
    const png = Uint8Array.from(Buffer.from(PNG_1X1_B64, "base64"));

    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        "content-length": String(png.byteLength),
        "content-type": "image/png"
      });
      res.end(Buffer.from(png));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/asset.png`;

    const client = createR2ClientFromS3({
      config: {
        accountId: "test",
        bucket,
        accessKeyId: "test",
        secretAccessKey: "test",
        endpoint,
        region: "us-east-1",
        publicBaseUrl: "https://cdn.example.com"
      },
      s3
    });

    try {
      const result = await client.uploadFromUrl(url, {
        key: "integration/asset.png",
        bufferThresholdBytes: 64 * 1024
      });

      expect(result.key).toBe("integration/asset.png");
      expect(result.contentType).toBe("image/png");
      expect(result.publicUrl).toBe("https://cdn.example.com/integration/asset.png");
      expect(result.etag).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

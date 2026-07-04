import { timingSafeEqual } from "node:crypto";

export function verifyBearerAuth(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice("Bearer ".length);
  const expected = Buffer.from(secret, "utf8");
  const received = Buffer.from(token, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

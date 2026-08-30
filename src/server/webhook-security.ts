import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyRazorpaySignature(rawBody: Uint8Array, providedHex: string, secrets: readonly string[]): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(providedHex) || secrets.length === 0) return false;
  const provided = Buffer.from(providedHex, "hex");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

// A valid 32-byte key, set before importing the crypto module reads it.
beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  it("round-trips a token unchanged", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const token = "canvas~AbCdEf123456";
    const sealed = encrypt(token);
    expect(sealed).not.toContain(token); // stored value is not plain text
    expect(decrypt(sealed)).toBe(token);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("refuses tampered data instead of returning garbage", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const sealed = encrypt("secret");
    // Flip the last byte of the base64 payload.
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = bytes.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });
});

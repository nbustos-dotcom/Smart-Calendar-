import "server-only";
import crypto from "node:crypto";

// Server-only encryption for the Canvas token.
//
// WHY this exists: the Canvas token is the one real secret a user hands us. We
// never want it stored in plain text in the database, and it must never be sent
// to the browser. So we encrypt it here, on the server, with a key that lives in
// an env var (APP_ENCRYPTION_KEY) and never touches the client.
//
// We use AES-256-GCM, which also authenticates the data: if the stored bytes are
// tampered with, decryption throws instead of returning garbage.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the standard size for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (a base64 of 32 random bytes)."
    );
  }
  return key;
}

// Returns a single base64 string containing: iv + authTag + ciphertext.
export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logDbEvent } from "./dbErrors.js";

/**
 * Application-level authenticated encryption for `Transaction.rawProviderPayload`
 * (security audit finding H3). This column preserves a provider's raw sync
 * response verbatim for audit/debugging — currently harmless synthetic mock
 * data, but the highest-sensitivity column in the schema the moment a real
 * banking provider is ever wired up, since it may carry more of the
 * provider's original response than the normalized fields do.
 *
 * `rawProviderPayload` stays a plain `Json?` column — no schema change is
 * needed, only what gets put into it: instead of the payload itself, an
 * envelope `{ v, alg, iv, authTag, ciphertext }` produced by AES-256-GCM
 * (authenticated encryption, not just encoding — a tampered or truncated
 * envelope fails to decrypt rather than silently returning garbage).
 *
 * The key comes from TRANSACTION_PAYLOAD_ENCRYPTION_KEY (base64, 32 bytes)
 * only — never hardcoded, never committed. When it's missing:
 *  - in production, encryptForStorage throws rather than ever persisting a
 *    payload as plaintext (fail closed — this is the environment where
 *    real provider payloads would actually land).
 *  - outside production (no real provider is wired anywhere in this repo
 *    yet), it returns undefined so the column is simply left null instead
 *    of storing plaintext — MockProvider's synthetic payload is discarded,
 *    not exposed, and every current caller already treats this field as
 *    optional/never-displayed, so nothing depends on it being populated.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedPayloadEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedPayloadEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && v.alg === "aes-256-gcm" && typeof v.iv === "string" && typeof v.authTag === "string" && typeof v.ciphertext === "string";
}

/** Never logs or throws the key material itself — only whether it was present/well-formed. */
function getEncryptionKey(): Buffer | null {
  const raw = process.env.TRANSACTION_PAYLOAD_ENCRYPTION_KEY;
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("TRANSACTION_PAYLOAD_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`TRANSACTION_PAYLOAD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * Returns an encrypted envelope to store, or `undefined` to store nothing
 * (leave the column null) — never the plaintext payload. Throws in
 * production if no key is configured, since that's the environment where a
 * real provider payload landing here unencrypted would be a real exposure.
 */
export function encryptForStorage(payload: unknown): EncryptedPayloadEnvelope | undefined {
  if (payload === null || payload === undefined) return undefined;

  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "TRANSACTION_PAYLOAD_ENCRYPTION_KEY is required in production to store a raw provider payload; refusing to persist it in any form.",
      );
    }
    logDbEvent("raw_payload_encryption_key_missing", { stored: false });
    return undefined;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/**
 * Decrypts an envelope produced by encryptForStorage. Server-side only, and
 * only for a caller that explicitly needs the raw payload back (nothing in
 * the app currently does — this exists for future authorized audit/debug
 * use). Fails closed: throws on a missing/misconfigured key, a value that
 * isn't a well-formed envelope (e.g. a historical plaintext row from before
 * this change), or a tampered/wrong-key ciphertext — never silently returns
 * partial or incorrect data. Never includes the key or the payload contents
 * in a thrown message.
 */
export function decryptFromStorage(stored: unknown): unknown {
  if (stored === null || stored === undefined) return null;

  if (!isEncryptedEnvelope(stored)) {
    throw new Error("Stored value is not a recognized encrypted payload envelope.");
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error("TRANSACTION_PAYLOAD_ENCRYPTION_KEY is not configured; cannot decrypt.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, "base64"));
  decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));

  try {
    const plaintext = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Failed to decrypt stored payload: authentication tag mismatch or wrong key.");
  }
}

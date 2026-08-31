import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logDbEvent } from "./dbErrors.js";

/**
 * General-purpose application-level authenticated encryption envelope,
 * originally built for `Transaction.rawProviderPayload` (security audit
 * finding H3). That column no longer exists: Task 6B's data-minimisation
 * pass removed raw-provider-payload storage from the ingestion path
 * entirely (see apps/worker/src/syncConnection.ts,
 * packages/db/src/seedHousehold.ts, and
 * docs/banking-data-minimisation-audit.md) rather than continuing to
 * encrypt-and-keep it — data FrodoCodo never retains cannot later leak,
 * which is a stronger guarantee than encryption-at-rest alone.
 *
 * This utility is kept (not tied to any specific column) because it's
 * exactly the mechanism a future need identified in the Task 6A audit will
 * require: encrypting a provider/CDR access or refresh token at rest once
 * a real banking connection exists (docs/banking-data-minimisation-audit.md
 * §8 — a stolen token is the single most sensitive thing FrodoCodo would
 * ever hold). Nothing in this codebase calls `encryptForStorage`/
 * `decryptFromStorage` today; `packages/db/src/__tests__/payloadEncryption.test.ts`
 * exercises the utility directly.
 *
 * Produces an envelope `{ v, alg, iv, authTag, ciphertext }` via
 * AES-256-GCM (authenticated encryption, not just encoding — a tampered or
 * truncated envelope fails to decrypt rather than silently returning
 * garbage).
 *
 * The key comes from TRANSACTION_PAYLOAD_ENCRYPTION_KEY (base64, 32 bytes)
 * only — never hardcoded, never committed. When it's missing:
 *  - in production, encryptForStorage throws rather than ever persisting a
 *    payload as plaintext (fail closed).
 *  - outside production, it returns undefined rather than storing
 *    plaintext.
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

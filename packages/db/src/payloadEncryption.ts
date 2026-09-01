import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logDbEvent } from "./dbErrors.js";

/**
 * General-purpose application-level authenticated encryption envelope.
 * Originally built for `Transaction.rawProviderPayload` (security audit
 * finding H3); that column no longer exists — Task 6B's data-minimisation
 * pass removed raw-provider-payload storage from the ingestion path
 * entirely (see apps/worker/src/syncConnection.ts,
 * packages/db/src/seedHousehold.ts, and
 * docs/banking-data-minimisation-audit.md) rather than continuing to
 * encrypt-and-keep it — data FrodoCodo never retains cannot later leak,
 * which is a stronger guarantee than encryption-at-rest alone.
 *
 * Task 7A gives this utility its first real caller:
 * `packages/db/src/connectionTokenStorage.ts` uses it to encrypt a
 * provider connection's access/refresh token
 * (`FinancialConnection.accessTokenEncrypted`/`refreshTokenEncrypted`) —
 * exactly the future need this file was kept for after H3 (see
 * docs/banking-data-minimisation-audit.md §8). The env var was renamed
 * from `TRANSACTION_PAYLOAD_ENCRYPTION_KEY` to `APP_ENCRYPTION_KEY`
 * accordingly — the old name became actively misleading once it started
 * protecting more than transaction payloads.
 *
 * Produces an envelope `{ v, alg, iv, authTag, ciphertext }` via
 * AES-256-GCM (authenticated encryption, not just encoding — a tampered or
 * truncated envelope fails to decrypt rather than silently returning
 * garbage).
 *
 * The key comes from APP_ENCRYPTION_KEY (base64, 32 bytes) only — never
 * hardcoded, never committed. When it's missing:
 *  - in production, encryptForStorage throws rather than ever persisting a
 *    secret as plaintext (fail closed).
 *  - outside production, it returns undefined rather than storing
 *    plaintext.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENV_VAR = "APP_ENCRYPTION_KEY";

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
  const raw = process.env[ENV_VAR];
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${ENV_VAR} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`${ENV_VAR} must decode to ${KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * Returns an encrypted envelope to store, or `undefined` to store nothing
 * (leave the column null) — never the plaintext payload. Throws in
 * production if no key is configured, since that's the environment where a
 * real secret (a provider token today) landing here unencrypted would be a
 * real exposure.
 */
export function encryptForStorage(payload: unknown): EncryptedPayloadEnvelope | undefined {
  if (payload === null || payload === undefined) return undefined;

  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${ENV_VAR} is required in production to store this value; refusing to persist it in any form.`);
    }
    logDbEvent("app_encryption_key_missing", { stored: false });
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
 * only for a caller that explicitly needs the plaintext back (today: the
 * worker, to present a valid provider token on the next sync — see
 * packages/db/src/connectionTokenStorage.ts). Fails closed: throws on a
 * missing/misconfigured key, a value that isn't a well-formed envelope, or
 * a tampered/wrong-key ciphertext — never silently returns partial or
 * incorrect data. Never includes the key or the payload contents in a
 * thrown message.
 */
export function decryptFromStorage(stored: unknown): unknown {
  if (stored === null || stored === undefined) return null;

  if (!isEncryptedEnvelope(stored)) {
    throw new Error("Stored value is not a recognized encrypted payload envelope.");
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(`${ENV_VAR} is not configured; cannot decrypt.`);
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

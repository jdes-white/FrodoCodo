/**
 * Turns an unknown thrown value from a Prisma/pg call into a small, safe
 * object for logging or returning from an API route — never the raw error
 * (which can carry a connection string, in `PrismaClientInitializationError`
 * messages that echo back the DSN) and never a full stack trace to a client.
 * Used by both the /api/health/db route and the login server action so a
 * real production failure is attributable instead of guessed at — see
 * docs/deployment.md.
 */

export interface SanitizedDbError {
  /** e.g. "PrismaClientInitializationError", "PrismaClientKnownRequestError" */
  errorName: string;
  /** Prisma's own error code, e.g. "P1001", "P2010" — present on known-request/initialization errors. */
  prismaCode?: string;
  /** The underlying PostgreSQL error code, e.g. "28P01", "3D000" — present when the driver surfaced one. */
  postgresCode?: string;
  /** Redacted, length-capped message. Never the raw error message unfiltered. */
  message: string;
}

// Anything shaped like a connection string (scheme://user:pass@host) or a
// credential-bearing key=value pair. Postgres/driver error messages
// sometimes echo the DSN they failed to connect with (e.g. "connect
// ECONNREFUSED" doesn't, but some libpq-style messages do) — redact
// defensively rather than trust that a given error class never does.
const SECRET_PATTERNS: RegExp[] = [/[a-z][a-z0-9+.-]*:\/\/\S*/gi, /\b(password|pwd|user|username|token|apikey|api_key)\s*[=:]\s*\S+/gi];

function redact(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.slice(0, 500);
}

function isPrismaCode(value: unknown): value is string {
  return typeof value === "string" && /^P\d{4}$/.test(value);
}

export function sanitizeDbError(error: unknown): SanitizedDbError {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError", message: redact(String(error)) };
  }

  const err = error as Error & { code?: unknown; errorCode?: unknown; cause?: unknown };
  const errorName = err.name || err.constructor?.name || "Error";
  const message = redact(err.message ?? String(error));

  let prismaCode: string | undefined;
  let postgresCode: string | undefined;
  for (const candidate of [err.code, err.errorCode]) {
    if (isPrismaCode(candidate)) prismaCode = candidate;
    else if (typeof candidate === "string" && !postgresCode) postgresCode = candidate;
  }

  // Driver-adapter errors (@prisma/adapter-pg) nest the real pg/network
  // error under `.cause` rather than a top-level `.code` — see
  // node_modules/@prisma/driver-adapter-utils's DriverAdapterError.
  const cause = err.cause as { code?: unknown } | undefined;
  if (!postgresCode && typeof cause?.code === "string" && !isPrismaCode(cause.code)) {
    postgresCode = cause.code;
  }

  return { errorName, prismaCode, postgresCode, message };
}

/** Structured, secret-free console logging for DB lifecycle events. */
export function logDbEvent(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  console.log(JSON.stringify({ scope: "db", event, ...fields }));
}

export function logDbError(event: string, error: unknown, fields: Record<string, string | number | boolean | undefined> = {}): SanitizedDbError {
  const sanitized = sanitizeDbError(error);
  console.error(JSON.stringify({ scope: "db", event, ...fields, ...sanitized }));
  return sanitized;
}

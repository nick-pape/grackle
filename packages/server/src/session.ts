import { randomBytes, createHmac } from "node:crypto";

/** Name of the session cookie sent to browsers. */
export const SESSION_COOKIE_NAME: string = "grackle_session";

/** Default session lifetime: 24 hours. */
const SESSION_TTL_MS: number = 24 * 60 * 60 * 1000;

/** Byte length of the random session identifier. */
const SESSION_ID_BYTES: number = 32;

/** Interval at which expired sessions are cleaned up. */
const SESSION_CLEANUP_INTERVAL_MS: number = 60 * 1000;

interface SessionRecord {
  createdAt: number;
  expiresAt: number;
}

/** In-memory session store keyed by session ID. */
const sessions: Map<string, SessionRecord> = new Map<string, SessionRecord>();

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/** Start the periodic session cleanup timer. Call once on server startup. */
export function startSessionCleanup(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, record] of sessions) {
      if (now > record.expiresAt) {
        sessions.delete(id);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is still running
  cleanupTimer.unref();
}

/** Stop the periodic session cleanup timer. */
export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/**
 * Create an HMAC-SHA256 signature of a value using the given secret.
 * Returns a hex-encoded string.
 */
function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Create a new session and return the Set-Cookie header value.
 *
 * The cookie format is `<sessionId>.<signature>` where the signature
 * is an HMAC-SHA256 of the session ID using the API key as secret.
 *
 * When `options.secure` is true the cookie includes the `Secure` flag,
 * which tells browsers to only send it over HTTPS. This should be
 * enabled when the server is network-accessible (`--allow-network`)
 * behind a TLS-terminating reverse proxy.
 */
export function createSession(apiKey: string, options?: { secure?: boolean }): string {
  const sessionId = randomBytes(SESSION_ID_BYTES).toString("hex");
  const now = Date.now();
  sessions.set(sessionId, {
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  const signature = sign(sessionId, apiKey);
  const cookieValue = `${sessionId}.${signature}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const securePart = options?.secure ? "; Secure" : "";

  return `${SESSION_COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/${securePart}; Max-Age=${maxAge}`;
}

/**
 * Parse a raw Cookie header into key-value pairs.
 *
 * Handles the standard `name=value; name2=value2` format.
 */
export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) {
    return result;
  }
  for (const pair of header.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    result[name] = value;
  }
  return result;
}

/**
 * Validate a session cookie from a raw Cookie header string.
 *
 * Returns true if the cookie contains a valid, non-expired session
 * with a correct HMAC signature.
 */
export function validateSessionCookie(cookieHeader: string, apiKey: string): boolean {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) {
    return false;
  }

  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }

  const sessionId = raw.slice(0, dotIndex);
  const providedSignature = raw.slice(dotIndex + 1);
  const expectedSignature = sign(sessionId, apiKey);

  // Constant-time comparison for the signature
  if (providedSignature.length !== expectedSignature.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    // eslint-disable-next-line no-bitwise
    diff |= providedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  if (diff !== 0) {
    return false;
  }

  // Check session exists and hasn't expired
  const record = sessions.get(sessionId);
  if (!record) {
    return false;
  }
  if (Date.now() > record.expiresAt) {
    sessions.delete(sessionId);
    return false;
  }

  return true;
}

/** Remove all sessions (useful for testing). */
export function clearSessions(): void {
  sessions.clear();
}

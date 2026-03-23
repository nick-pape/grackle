import { randomBytes } from "node:crypto";
import { getAuthLogger } from "./auth-logger.js";

/** How long a pairing code is valid after generation. */
const PAIRING_CODE_TTL_MS: number = 5 * 60 * 1000;

/** Maximum number of active (unexpired) pairing codes. */
const MAX_ACTIVE_CODES: number = 10;

/** Number of characters in a pairing code. */
const PAIRING_CODE_LENGTH: number = 6;

/** Maximum failed redemption attempts per IP before blocking. */
const MAX_FAILED_ATTEMPTS: number = 5;

/** Duration to block an IP after exceeding failed attempts. */
const RATE_LIMIT_WINDOW_MS: number = 60 * 1000;

/** Duration to block an IP after exceeding the rate limit. */
const RATE_LIMIT_BLOCK_MS: number = 5 * 60 * 1000;

/** Interval at which expired codes and rate-limit entries are cleaned up. */
const CLEANUP_INTERVAL_MS: number = 60 * 1000;

interface PairingRecord {
  code: string;
  createdAt: number;
  expiresAt: number;
}

interface RateLimitRecord {
  attempts: number;
  firstAttempt: number;
  blockedUntil: number;
}

/** Active pairing codes keyed by code string (uppercase). */
const activeCodes: Map<string, PairingRecord> = new Map<string, PairingRecord>();

/** Rate-limit tracking keyed by remote IP. */
const rateLimits: Map<string, RateLimitRecord> = new Map<string, RateLimitRecord>();

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/** Start the periodic cleanup timer. Call once on server startup. */
export function startPairingCleanup(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, record] of activeCodes) {
      if (now > record.expiresAt) {
        activeCodes.delete(code);
      }
    }
    for (const [ip, record] of rateLimits) {
      if (now > record.blockedUntil && now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        rateLimits.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is still running
  cleanupTimer.unref();
}

/** Stop the periodic cleanup timer. */
export function stopPairingCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/**
 * Generate a new pairing code.
 *
 * Returns the 6-character uppercase alphanumeric code, or undefined
 * if the maximum number of active codes has been reached.
 */
export function generatePairingCode(): string | undefined {
  // Purge expired codes first
  const now = Date.now();
  for (const [code, record] of activeCodes) {
    if (now > record.expiresAt) {
      activeCodes.delete(code);
    }
  }

  if (activeCodes.size >= MAX_ACTIVE_CODES) {
    getAuthLogger().warn({}, "Maximum active pairing codes reached (%d)");
    return undefined;
  }

  // Generate a code that doesn't collide with existing ones
  let code: string;
  do {
    code = randomBytes(4)
      .toString("base64url")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, PAIRING_CODE_LENGTH)
      .toUpperCase();
  } while (code.length < PAIRING_CODE_LENGTH || activeCodes.has(code));

  const record: PairingRecord = {
    code,
    createdAt: now,
    expiresAt: now + PAIRING_CODE_TTL_MS,
  };
  activeCodes.set(code, record);
  getAuthLogger().info({ expiresIn: PAIRING_CODE_TTL_MS / 1000 }, "Generated pairing code");
  return code;
}

/**
 * Attempt to redeem a pairing code. Returns true if the code was valid
 * and has been consumed (burned). Returns false otherwise.
 *
 * @param code - The pairing code to redeem (case-insensitive).
 * @param remoteIp - The remote IP address for rate limiting.
 */
export function redeemPairingCode(code: string, remoteIp: string): boolean {
  const now = Date.now();
  const normalised = code.toUpperCase().trim();

  // Check rate limit
  const limit = rateLimits.get(remoteIp);
  if (limit && now < limit.blockedUntil) {
    getAuthLogger().warn({ remoteIp }, "Pairing attempt blocked by rate limit");
    return false;
  }

  const record = activeCodes.get(normalised);
  if (!record || now > record.expiresAt) {
    // Record failed attempt
    if (limit) {
      if (now - limit.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        // Reset window
        rateLimits.set(remoteIp, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
      } else {
        limit.attempts++;
        if (limit.attempts >= MAX_FAILED_ATTEMPTS) {
          limit.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
          getAuthLogger().warn({ remoteIp, attempts: limit.attempts }, "Rate limit triggered for pairing attempts");
        }
      }
    } else {
      rateLimits.set(remoteIp, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
    }

    if (record && now > record.expiresAt) {
      activeCodes.delete(normalised);
    }
    return false;
  }

  // Burn the code — single use
  activeCodes.delete(normalised);
  getAuthLogger().info({}, "Pairing code redeemed");
  return true;
}

/** Clear all pairing codes and rate limits (for testing). */
export function clearPairing(): void {
  activeCodes.clear();
  rateLimits.clear();
}

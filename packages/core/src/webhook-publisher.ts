/**
 * Reusable webhook publisher with retry and exponential backoff.
 *
 * Wraps fetch() + AbortController timeout behind {@link retryWithBackoff} so
 * callers get consistent retry semantics without managing their own loops.
 * Non-2xx responses are treated as transient failures and retried.
 */

import { retryWithBackoff } from "@grackle-ai/adapter-sdk";
import { logger } from "./logger.js";
import {
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAY_MS,
  WEBHOOK_BACKOFF_MULTIPLIER,
  WEBHOOK_MAX_DELAY_MS,
} from "./constants.js";

/**
 * POST a JSON payload to `url` with retry and exponential backoff.
 * Non-2xx responses and network errors are retried up to {@link WEBHOOK_MAX_ATTEMPTS} times.
 *
 * @param url - The webhook endpoint.
 * @param payload - JSON-serializable body.
 * @throws The last error when all attempts are exhausted.
 */
export async function postWebhook(url: string, payload: unknown): Promise<void> {
  // Serialize once — a non-serializable payload can never succeed on retry.
  const body: string = JSON.stringify(payload);
  await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body,
        });
        try {
          if (!response.ok) {
            throw new Error(`Webhook returned HTTP ${response.status}`);
          }
        } finally {
          // Drain the body so the underlying connection is released.
          await response.arrayBuffer().catch(() => undefined);
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      delayMs: WEBHOOK_RETRY_DELAY_MS,
      backoffMultiplier: WEBHOOK_BACKOFF_MULTIPLIER,
      maxDelayMs: WEBHOOK_MAX_DELAY_MS,
      onRetry: (attempt, err) => {
        logger.warn({ attempt, err, url }, "Webhook delivery failed, retrying");
      },
    },
  );
}

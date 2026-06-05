import type { Interceptor } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import { GrackleError } from "@grackle-ai/common";
import { logger } from "./logger.js";

/**
 * Translate a caught error into a ConnectError for the gRPC wire.
 *
 * - ConnectError → pass through unchanged
 * - GrackleError → new ConnectError with the domain error's code and message;
 *   structured context is logged at debug level before being discarded
 * - Anything else → ConnectError.from (produces Code.Unknown with cause)
 */
function translateError(err: unknown): ConnectError {
  if (err instanceof ConnectError) {
    return err;
  }
  if (err instanceof GrackleError) {
    if (Object.keys(err.context).length > 0) {
      logger.debug({ err: err.message, code: err.code, ...err.context }, "GrackleError context");
    }
    return new ConnectError(err.message, err.code);
  }
  return ConnectError.from(err);
}

/** Wrap a streaming async iterable so errors during iteration are translated. */
async function* wrapStreamErrors<T>(iterable: AsyncIterable<T>): AsyncIterable<T> {
  try {
    yield* iterable;
  } catch (err) {
    throw translateError(err);
  }
}

/**
 * Server-side interceptor that translates {@link GrackleError} instances into
 * ConnectError at the gRPC boundary.
 *
 * Install as the **first** (outermost) interceptor so it catches errors from
 * all inner interceptors and handlers. For streaming RPCs, wraps the response
 * iterable so errors thrown during iteration are also translated.
 */
export const grackleErrorInterceptor: Interceptor = (next) => async (req) => {
  const response = await next(req).catch((err: unknown) => {
    throw translateError(err);
  });

  if ("stream" in response && response.stream) {
    const original = response.message as AsyncIterable<unknown>;
    (response as { message: AsyncIterable<unknown> }).message = wrapStreamErrors(original);
  }

  return response;
};

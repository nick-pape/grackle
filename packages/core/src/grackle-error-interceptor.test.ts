import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  GrackleError,
  NotFoundError,
  PreconditionError,
  ValidationError,
} from "@grackle-ai/common";
import { grackleErrorInterceptor } from "./grackle-error-interceptor.js";
import { wrapAsyncIterableWithTrace, getTraceId, runWithTrace } from "./trace-context.js";

/**
 * Build a fake unary "next" function for the interceptor.
 * The handler either returns a value or throws.
 */
function unaryNext(handler: () => unknown): (req: unknown) => Promise<unknown> {
  return async () => handler();
}

/**
 * Build a fake streaming "next" function.
 * Returns a response with `stream: true` and `message` as an AsyncIterable.
 */
function streamingNext(
  gen: () => AsyncIterable<unknown>,
): (req: unknown) => Promise<{ stream: true; message: AsyncIterable<unknown> }> {
  return async () => ({ stream: true, message: gen() });
}

/** Collect all values from an async iterable. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}

describe("grackleErrorInterceptor", () => {
  describe("unary RPCs", () => {
    it("passes through a successful response", async () => {
      const wrapped = grackleErrorInterceptor(unaryNext(() => ({ value: 42 })));
      const result = await wrapped({} as never);
      expect(result).toEqual({ value: 42 });
    });

    it("translates NotFoundError to ConnectError with Code.NotFound", async () => {
      const wrapped = grackleErrorInterceptor(
        unaryNext(() => {
          throw new NotFoundError("Task not found");
        }),
      );
      await expect(wrapped({} as never)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ConnectError);
        const ce = err as ConnectError;
        expect(ce.code).toBe(Code.NotFound);
        expect(ce.rawMessage).toBe("Task not found");
        return true;
      });
    });

    it("translates ValidationError to ConnectError with Code.InvalidArgument", async () => {
      const wrapped = grackleErrorInterceptor(
        unaryNext(() => {
          throw new ValidationError("name is required");
        }),
      );
      await expect(wrapped({} as never)).rejects.toSatisfy((err: unknown) => {
        const ce = err as ConnectError;
        expect(ce).toBeInstanceOf(ConnectError);
        expect(ce.code).toBe(Code.InvalidArgument);
        expect(ce.rawMessage).toBe("name is required");
        return true;
      });
    });

    it("translates GrackleError with custom code", async () => {
      const wrapped = grackleErrorInterceptor(
        unaryNext(() => {
          throw new GrackleError("rate limited", Code.ResourceExhausted);
        }),
      );
      await expect(wrapped({} as never)).rejects.toSatisfy((err: unknown) => {
        const ce = err as ConnectError;
        expect(ce).toBeInstanceOf(ConnectError);
        expect(ce.code).toBe(Code.ResourceExhausted);
        return true;
      });
    });

    it("passes through ConnectError unchanged", async () => {
      const original = new ConnectError("already a connect error", Code.Aborted);
      const wrapped = grackleErrorInterceptor(
        unaryNext(() => {
          throw original;
        }),
      );
      await expect(wrapped({} as never)).rejects.toBe(original);
    });

    it("translates plain Error via ConnectError.from", async () => {
      const wrapped = grackleErrorInterceptor(
        unaryNext(() => {
          throw new Error("unexpected");
        }),
      );
      await expect(wrapped({} as never)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ConnectError);
        return true;
      });
    });
  });

  describe("streaming RPCs", () => {
    it("passes through a successful stream", async () => {
      async function* gen(): AsyncIterable<number> {
        yield 1;
        yield 2;
        yield 3;
      }
      const wrapped = grackleErrorInterceptor(streamingNext(gen));
      const response = (await wrapped({} as never)) as {
        stream: true;
        message: AsyncIterable<number>;
      };
      expect(response.stream).toBe(true);
      const values = await collect(response.message);
      expect(values).toEqual([1, 2, 3]);
    });

    it("translates GrackleError thrown mid-stream", async () => {
      async function* gen(): AsyncIterable<number> {
        yield 1;
        yield 2;
        throw new PreconditionError("environment disconnected");
      }
      const wrapped = grackleErrorInterceptor(streamingNext(gen));
      const response = (await wrapped({} as never)) as {
        stream: true;
        message: AsyncIterable<number>;
      };

      const collected: number[] = [];
      await expect(
        (async () => {
          for await (const item of response.message) {
            collected.push(item as number);
          }
        })(),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ConnectError);
        const ce = err as ConnectError;
        expect(ce.code).toBe(Code.FailedPrecondition);
        expect(ce.rawMessage).toBe("environment disconnected");
        return true;
      });
      expect(collected).toEqual([1, 2]);
    });

    it("passes through ConnectError in stream unchanged", async () => {
      const original = new ConnectError("stream abort", Code.Aborted);
      async function* gen(): AsyncIterable<number> {
        yield 1;
        throw original;
      }
      const wrapped = grackleErrorInterceptor(streamingNext(gen));
      const response = (await wrapped({} as never)) as {
        stream: true;
        message: AsyncIterable<number>;
      };

      await expect(
        (async () => {
          for await (const _ of response.message) {
            // consume
          }
        })(),
      ).rejects.toBe(original);
    });
  });

  describe("composition with trace-context interceptor", () => {
    /**
     * Simulates the real server interceptor stack: error interceptor (outermost)
     * wraps trace interceptor (inner), which wraps the handler's stream with
     * wrapAsyncIterableWithTrace. A GrackleError thrown mid-stream must still
     * be translated to ConnectError even when the trace wrapper sits between.
     */
    it("translates GrackleError mid-stream when trace wrapper is in the middle", async () => {
      const traceId = "test-trace-abc";

      async function* handlerStream(): AsyncIterable<number> {
        yield 1;
        yield 2;
        throw new NotFoundError("stream entity gone");
      }

      const traceInterceptor =
        (next: (req: unknown) => Promise<unknown>) => async (req: unknown) => {
          const response = await runWithTrace(traceId, () => next(req));
          if (typeof response === "object" && response !== null && "stream" in response) {
            const resp = response as { stream: true; message: AsyncIterable<unknown> };
            resp.message = wrapAsyncIterableWithTrace(traceId, resp.message);
          }
          return response;
        };

      const composedNext = streamingNext(handlerStream);
      const withTrace = traceInterceptor(composedNext);
      const withError = grackleErrorInterceptor(withTrace);

      const response = (await withError({} as never)) as {
        stream: true;
        message: AsyncIterable<number>;
      };

      const collected: number[] = [];
      await expect(
        (async () => {
          for await (const item of response.message) {
            collected.push(item as number);
          }
        })(),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ConnectError);
        const ce = err as ConnectError;
        expect(ce.code).toBe(Code.NotFound);
        expect(ce.rawMessage).toBe("stream entity gone");
        return true;
      });
      expect(collected).toEqual([1, 2]);
    });

    it("preserves trace context through successful stream with error interceptor", async () => {
      const traceId = "trace-preserve-123";
      const capturedIds: (string | undefined)[] = [];

      async function* handlerStream(): AsyncIterable<number> {
        capturedIds.push(getTraceId());
        yield 1;
        capturedIds.push(getTraceId());
        yield 2;
      }

      const traceInterceptor =
        (next: (req: unknown) => Promise<unknown>) => async (req: unknown) => {
          const response = await runWithTrace(traceId, () => next(req));
          if (typeof response === "object" && response !== null && "stream" in response) {
            const resp = response as { stream: true; message: AsyncIterable<unknown> };
            resp.message = wrapAsyncIterableWithTrace(traceId, resp.message);
          }
          return response;
        };

      const composedNext = streamingNext(handlerStream);
      const withTrace = traceInterceptor(composedNext);
      const withError = grackleErrorInterceptor(withTrace);

      const response = (await withError({} as never)) as {
        stream: true;
        message: AsyncIterable<number>;
      };
      const values = await collect(response.message);

      expect(values).toEqual([1, 2]);
      expect(capturedIds).toEqual([traceId, traceId]);
    });
  });
});

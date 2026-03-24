import { vi } from "vitest";

/** Create a no-op async iterator with a cancel method. */
function emptyStream(): AsyncGenerator & { cancel: ReturnType<typeof vi.fn> } {
  const iter = (async function* (): AsyncGenerator { /* empty */ })();
  return Object.assign(iter, { cancel: vi.fn() });
}

export const publish = vi.fn();
export const createStream = vi.fn(() => emptyStream());
export const createGlobalStream = vi.fn(() => emptyStream());

/**
 * Single-producer-multi-consumer push/pull queue with an `AsyncIterable`
 * adapter. Used internally by {@link SubscriptionTracker} to buffer
 * {@link SubscriptionMessage}s for `for await` consumers of
 * {@link MultiHostClient.subscribe}.
 *
 * Mirrors `packages/runtime-sdk/src/async-queue.ts:1-48` deliberately — kept
 * inlined here so `@grackle-ai/adapter-sdk` does not gain a new dependency
 * edge on `@grackle-ai/runtime-sdk`. Both copies should evolve together; if
 * they diverge, update both.
 *
 * @internal
 */
export class AsyncQueue<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private closedFlag: boolean = false;

  /** Enqueue an item. Silently dropped after {@link close}. */
  public push(item: T): void {
    if (this.closedFlag) {
      return;
    }
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter(item);
    } else {
      this.queue.push(item);
    }
  }

  /** Dequeue the next item, awaiting one if the queue is empty. `undefined` after close drains. */
  public async shift(): Promise<T | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    if (this.closedFlag) {
      return undefined;
    }
    return new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Mark the queue closed; pending waiters resolve with `undefined`. Idempotent. */
  public close(): void {
    if (this.closedFlag) {
      return;
    }
    this.closedFlag = true;
    for (const waiter of this.waiters) {
      waiter(undefined);
    }
    this.waiters.length = 0;
  }

  /** True once {@link close} has been called. */
  public get closed(): boolean {
    return this.closedFlag;
  }

  /** Adapter that yields items until the queue is closed and drained. */
  public async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      const item = await this.shift();
      if (item === undefined) {
        return;
      }
      yield item;
    }
  }
}

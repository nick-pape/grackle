/** A simple async queue that implements `AsyncIterable`, allowing consumers to `for await` over pushed items. */
export class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter(item);
    } else {
      this.queue.push(item);
    }
  }

  async shift(): Promise<T | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    if (this.closed) return undefined;
    return new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter(undefined);
    }
    this.waiters.length = 0;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      const item = await this.shift();
      if (item === undefined && this.closed) return;
      if (item !== undefined) yield item;
    }
  }
}

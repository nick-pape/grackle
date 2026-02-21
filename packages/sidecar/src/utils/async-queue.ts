export class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T) => void> = [];
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
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    // Resolve all pending waiters with undefined
    for (const waiter of this.waiters) {
      waiter(undefined as unknown as T);
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

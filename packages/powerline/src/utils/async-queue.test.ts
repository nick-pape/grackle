import { describe, it, expect } from "vitest";
import { AsyncQueue } from "./async-queue.js";

describe("AsyncQueue", () => {
  it("push/shift follows FIFO ordering", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(await queue.shift()).toBe(1);
    expect(await queue.shift()).toBe(2);
    expect(await queue.shift()).toBe(3);
  });

  it("shift() blocks until push delivers an item", async () => {
    const queue = new AsyncQueue<string>();

    const shiftPromise = queue.shift();
    // Should not have resolved yet
    let resolved = false;
    shiftPromise.then(() => { resolved = true; });
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);

    queue.push("hello");
    const result = await shiftPromise;
    expect(result).toBe("hello");
  });

  it("push delivers directly to a waiting shift", async () => {
    const queue = new AsyncQueue<number>();

    // Start waiting before pushing
    const p1 = queue.shift();
    const p2 = queue.shift();

    queue.push(10);
    queue.push(20);

    expect(await p1).toBe(10);
    expect(await p2).toBe(20);
  });

  it("close() causes shift to return undefined", async () => {
    const queue = new AsyncQueue<number>();
    queue.close();

    expect(await queue.shift()).toBeUndefined();
  });

  it("close() resolves pending waiters with undefined", async () => {
    const queue = new AsyncQueue<number>();

    const p1 = queue.shift();
    const p2 = queue.shift();

    queue.close();

    expect(await p1).toBeUndefined();
    expect(await p2).toBeUndefined();
  });

  it("push is a no-op after close", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.close();
    queue.push(2); // should be ignored

    // First item was pushed before close so it's still in the buffer
    expect(await queue.shift()).toBe(1);
    // After that, queue is closed
    expect(await queue.shift()).toBeUndefined();
  });

  it("multiple close() calls are idempotent", () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    queue.close();
    queue.close();
    // No error thrown
  });

  it("async iteration yields all items and stops after close", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    // Close after a tick so the iterator can drain
    setTimeout(() => queue.close(), 0);

    const items: number[] = [];
    for await (const item of queue) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });

  it("interleaved push/iteration works correctly", async () => {
    const queue = new AsyncQueue<string>();

    const items: string[] = [];
    const iterationDone = (async () => {
      for await (const item of queue) {
        items.push(item);
      }
    })();

    queue.push("a");
    // Allow microtask to process
    await Promise.resolve();
    queue.push("b");
    await Promise.resolve();
    queue.push("c");
    await Promise.resolve();
    queue.close();

    await iterationDone;
    expect(items).toEqual(["a", "b", "c"]);
  });
});

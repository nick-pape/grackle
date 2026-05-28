import { describe, expect, it } from "vitest";

import { AsyncQueue } from "./async-queue.js";

describe("AsyncQueue", () => {
  it("delivers items pushed before shift is awaited", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    expect(await q.shift()).toBe(1);
    expect(await q.shift()).toBe(2);
  });

  it("delivers items pushed after shift is awaited", async () => {
    const q = new AsyncQueue<string>();
    const pending = q.shift();
    q.push("hi");
    expect(await pending).toBe("hi");
  });

  it("close drains waiters with undefined and stops further pushes", async () => {
    const q = new AsyncQueue<number>();
    const a = q.shift();
    const b = q.shift();
    q.close();
    expect(await a).toBeUndefined();
    expect(await b).toBeUndefined();
    q.push(42);
    expect(await q.shift()).toBeUndefined();
    expect(q.closed).toBe(true);
  });

  it("close is idempotent", () => {
    const q = new AsyncQueue<number>();
    q.close();
    q.close();
    expect(q.closed).toBe(true);
  });

  it("for-await iterates buffered + late items, terminates on close", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    setTimeout(() => {
      q.push(2);
      q.close();
    }, 0);
    const seen: number[] = [];
    for await (const v of q) {
      seen.push(v);
    }
    expect(seen).toEqual([1, 2]);
  });

  it("queues that close while empty yield no items", async () => {
    const q = new AsyncQueue<number>();
    q.close();
    const seen: number[] = [];
    for await (const v of q) {
      seen.push(v);
    }
    expect(seen).toEqual([]);
  });
});

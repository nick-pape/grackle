import { describe, expect, it, vi } from "vitest";

import { GenerationCounter } from "./generation-counter.js";

describe("GenerationCounter", () => {
  it("starts at 0", () => {
    const counter = new GenerationCounter();
    expect(counter.current()).toBe(0);
  });

  it("bump returns and stores the new value monotonically", () => {
    const counter = new GenerationCounter();
    expect(counter.bump()).toBe(1);
    expect(counter.bump()).toBe(2);
    expect(counter.bump()).toBe(3);
    expect(counter.current()).toBe(3);
  });

  it("fires onChange listeners with the new value on every bump", () => {
    const counter = new GenerationCounter();
    const listener = vi.fn();
    counter.onChange(listener);
    counter.bump();
    counter.bump();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 1);
    expect(listener).toHaveBeenNthCalledWith(2, 2);
  });

  it("returns an unsubscribe function that stops further calls", () => {
    const counter = new GenerationCounter();
    const listener = vi.fn();
    const unsub = counter.onChange(listener);
    counter.bump();
    unsub();
    counter.bump();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("multiple listeners fire independently; one unsubscribe does not affect others", () => {
    const counter = new GenerationCounter();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = counter.onChange(a);
    counter.onChange(b);
    counter.bump();
    unsubA();
    counter.bump();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe is idempotent", () => {
    const counter = new GenerationCounter();
    const listener = vi.fn();
    const unsub = counter.onChange(listener);
    unsub();
    unsub();
    counter.bump();
    expect(listener).not.toHaveBeenCalled();
  });
});

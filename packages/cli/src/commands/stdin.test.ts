import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { readStdinAll } from "./stdin.js";

describe("readStdinAll", () => {
  it("returns the trimmed concatenation of all chunks", async () => {
    const stream = Readable.from(["secret-value\n"]);
    expect(await readStdinAll(stream)).toBe("secret-value");
  });

  it("joins multiple chunks into one string", async () => {
    const stream = Readable.from(["sec", "ret", "-value"]);
    expect(await readStdinAll(stream)).toBe("secret-value");
  });

  it("returns an empty string when the stream is empty", async () => {
    const stream = Readable.from([]);
    expect(await readStdinAll(stream)).toBe("");
  });

  it("handles binary Buffer chunks (e.g. raw process.stdin)", async () => {
    const stream = Readable.from([Buffer.from("hello "), Buffer.from("world")]);
    expect(await readStdinAll(stream)).toBe("hello world");
  });

  it("strips surrounding whitespace and newlines", async () => {
    const stream = Readable.from(["\n  padded  \n\n"]);
    expect(await readStdinAll(stream)).toBe("padded");
  });
});

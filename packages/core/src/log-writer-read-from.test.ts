import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLogFrom } from "./log-writer.js";

// Real-fs tests for the incremental reader. (The sibling log-writer.test.ts
// mocks node:fs for writeEvent; byte-offset math must be tested against a real
// file, so this lives in its own unmocked file.)

describe("readLogFrom (incremental byte-offset reader)", () => {
  let dir: string;
  let stream: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kg-log-"));
    stream = join(dir, "stream.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function line(n: number): string {
    return JSON.stringify({ session_id: "s1", type: "text", timestamp: "t", content: `c${n}` });
  }

  it("returns empty when the log file does not exist", () => {
    expect(readLogFrom(dir, 0)).toEqual({ content: "", nextOffset: 0 });
  });

  it("reads all complete lines from offset 0 and reports the advanced offset", () => {
    const text = `${line(1)}\n${line(2)}\n`;
    writeFileSync(stream, text);
    const result = readLogFrom(dir, 0);
    expect(result.content).toBe(`${line(1)}\n${line(2)}`); // no trailing newline
    expect(result.nextOffset).toBe(Buffer.byteLength(text, "utf-8"));
  });

  it("reads only newly appended lines on the next call", () => {
    writeFileSync(stream, `${line(1)}\n`);
    const first = readLogFrom(dir, 0);
    appendFileSync(stream, `${line(2)}\n${line(3)}\n`);
    const second = readLogFrom(dir, first.nextOffset);
    expect(second.content).toBe(`${line(2)}\n${line(3)}`);
    expect(second.nextOffset).toBeGreaterThan(first.nextOffset);
    // A third call with no new data yields nothing and a stable offset.
    expect(readLogFrom(dir, second.nextOffset)).toEqual({
      content: "",
      nextOffset: second.nextOffset,
    });
  });

  it("does not consume a trailing partial (newline-less) line", () => {
    writeFileSync(stream, `${line(1)}\n{"partial":`);
    const result = readLogFrom(dir, 0);
    expect(result.content).toBe(line(1));
    expect(result.nextOffset).toBe(Buffer.byteLength(`${line(1)}\n`, "utf-8"));
    // Completing the partial line makes it readable next pass.
    appendFileSync(stream, `true}\n`);
    const next = readLogFrom(dir, result.nextOffset);
    expect(next.content).toBe(`{"partial":true}`);
  });

  it("computes byte offsets correctly across multi-byte UTF-8 content", () => {
    // Lines with multi-byte chars (é/☕ = 2-3 bytes, 😀 = 4 bytes). The cursor
    // must advance by BYTES, not string code units, or the next read desyncs.
    const l1 = JSON.stringify({ c: "café ☕" });
    const l2 = JSON.stringify({ c: "rollout 😀 done" });
    writeFileSync(stream, `${l1}\n`);
    const first = readLogFrom(dir, 0);
    expect(first.content).toBe(l1);
    expect(first.nextOffset).toBe(Buffer.byteLength(`${l1}\n`, "utf-8"));

    // Reading from the byte cursor returns exactly the appended line — no
    // leading/trailing garbage that a mis-counted (code-unit) offset would cause.
    appendFileSync(stream, `${l2}\n`);
    const second = readLogFrom(dir, first.nextOffset);
    expect(second.content).toBe(l2);
    expect(second.nextOffset).toBe(Buffer.byteLength(`${l1}\n${l2}\n`, "utf-8"));
  });

  it("resets to the start if the file shrank (truncated/rewritten)", () => {
    writeFileSync(stream, `${line(1)}\n${line(2)}\n`);
    const full = readLogFrom(dir, 0);
    writeFileSync(stream, `${line(9)}\n`); // smaller file
    const result = readLogFrom(dir, full.nextOffset); // stale (too-large) offset
    expect(result.content).toBe(line(9));
  });
});

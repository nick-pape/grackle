import { describe, it, expect, vi } from "vitest";
import { SequencedLog, type LogSink, type Sequenced } from "./sequenced-log.js";

describe("SequencedLog", () => {
  it("assigns the next sequence key from nextSeq and returns the entry", () => {
    const calls: Array<[string, Sequenced<string>]> = [];
    const sink: LogSink<string> = {
      append: (channelId, entry) => {
        calls.push([channelId, entry]);
      },
    };
    let n = 0;
    const log = new SequencedLog<string>({
      sink,
      channelId: "test",
      nextSeq: () => `seq-${++n}`,
    });

    const a = log.append("alpha");
    const b = log.append("beta");

    expect(a).toEqual({ seq: "seq-1", payload: "alpha" });
    expect(b).toEqual({ seq: "seq-2", payload: "beta" });
  });

  it("delegates each append to the sink exactly once, with the bound channel id", () => {
    const append = vi.fn();
    const sink: LogSink<string> = { append };
    const log = new SequencedLog<string>({ sink, channelId: "chan-x", nextSeq: () => "k" });

    log.append("hello");

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith("chan-x", { seq: "k", payload: "hello" });
  });

  it("preserves monotonic, ascending-sortable ordering across appends", () => {
    const recorded: Array<Sequenced<number>> = [];
    const sink: LogSink<number> = {
      append: (channelId, entry) => {
        expect(channelId).toBe("c");
        recorded.push(entry);
      },
    };
    let n = 100;
    const log = new SequencedLog<number>({ sink, channelId: "c", nextSeq: () => String(++n) });

    for (let i = 0; i < 5; i++) {
      log.append(i);
    }

    const seqs = recorded.map((e) => e.seq);
    expect(seqs).toEqual(["101", "102", "103", "104", "105"]);
    expect([...seqs].sort()).toEqual(seqs);
  });
});

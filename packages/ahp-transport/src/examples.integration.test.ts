import { describe, expect, it } from "vitest";

import { runEchoSubscriber } from "./examples/echo-subscriber.js";

describe("examples", () => {
  describe("echo subscriber", () => {
    it("connects, subscribes, and receives N action notifications in order", async () => {
      const { received, dispose } = await runEchoSubscriber(5);
      try {
        expect(received).toHaveLength(5);
        // Each notification's payload contains an incrementing `i`.
        const ids = (received as Array<{ action: { payload: { i: number } } }>).map(
          (r) => r.action.payload.i,
        );
        expect(ids).toEqual([0, 1, 2, 3, 4]);
        // Each has the channel set correctly.
        for (const notif of received as Array<{ channel: string }>) {
          expect(notif.channel).toBe("ahp-session:/echo");
        }
        // serverSeq is monotonically increasing.
        const seqs = (received as Array<{ serverSeq: number }>).map((r) => r.serverSeq);
        expect(seqs).toEqual([1, 2, 3, 4, 5]);
      } finally {
        await dispose();
      }
    });

    it("handles a higher count (50 notifications) without loss or reorder", async () => {
      const { received, dispose } = await runEchoSubscriber(50);
      try {
        expect(received).toHaveLength(50);
        const ids = (received as Array<{ action: { payload: { i: number } } }>).map(
          (r) => r.action.payload.i,
        );
        expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => i));
      } finally {
        await dispose();
      }
    });
  });
});

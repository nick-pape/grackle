# Core Package Rules

- **New `process.env` reads must go through the centralized config provider, not inline.**
- **Before adding a new utility (retry, timestamp, etc.), check if one already exists in common.** Don't re-implement.
- **If a file exceeds ~400 lines, split before adding to it.**

## Event Dispatch — Three Models, Intentionally Separate

Three dispatch mechanisms coexist by design; do not merge them:

| Module                 | Purpose                                                  | Error handling                                                                                                                                            |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-bus.ts`         | Domain events (best-effort fan-out to all subscribers)   | Subscribers may be sync or async. Rejections are caught per-subscriber and logged (`"Subscriber error"`). The emitter is never blocked.                   |
| `stream-registry.ts`   | IPC streams (tracked delivery with `Promise.allSettled`) | Dual-path: sync throws caught directly, async rejections caught via `.then` rejection handler. Delivery is tracked; undelivered messages can be replayed. |
| `webhook-publisher.ts` | External webhook delivery                                | Retried with exponential backoff (`retryWithBackoff` from `@grackle-ai/adapter-sdk`). Final exhaustion throws; caller logs and moves on.                  |

**Writing event-bus subscribers:** callbacks may be `async`; errors bubble up to the bus and are logged. Do **not** add a local try/catch + `.catch(() => {})` fire-and-forget wrapper — it is unnecessary and hides error context.

---
id: webhooks
title: Webhooks
sidebar_position: 3
---

# Webhooks

A channel is a door the outside world can knock on. Mint a URL, hand it out, and when something hits it the message lands in a live session. An agent that answers the wire.

The agent keeps working. The webhook just adds a voice from outside the room.

## Mint one

Expose a running session. You get back a webhook URL.

```bash
grackle channel expose --session <id>
```

```
Channel:  grackle:/sessions/<id>
Grant ID: 9f3c1a2b...
Webhook:  https://<host>/hook/<token>
Expires:  -
```

The `<token>` in the URL is the whole key. Whoever holds it can do the one thing it permits, to the one session it names. Nothing else.

| Flag              | Does                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `--session <id>`  | The session the webhook injects into. Required.                                             |
| `--verb <verb>`   | What the token may do. Defaults to `send_input` — the only verb the hook path honors today. |
| `--ttl <seconds>` | Lifetime. `0` (default) takes the server default. After this, the token is dead.            |
| `--label <text>`  | A name for the grant. For your eyes, at `ls` and `revoke` time.                             |

## Knock on it

```bash
curl -X POST https://<host>/hook/<token> \
  -H 'Content-Type: application/json' \
  -d '{"message": "deploy finished, look at the logs"}'
```

The message is injected into the session via the same path as typed input. The agent sees it and responds.

| Field             | Does                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `message`         | The text injected into the session. Required.                         |
| `from`            | Sender attribution, prefixed onto the message as `[from] ...`.        |
| `idempotency_key` | Dedupe key for retries. The same key inside the window delivers once. |

The token can ride in the path or in an `Authorization: Bearer <token>` header.

Responses say what happened: `200` delivered, `202` buffered, `403` forbidden (bad or revoked token), `404` the session is gone, `410` it ended.

## List and revoke

```bash
grackle channel ls
```

Every grant: id, channel, verbs, label, whether it's revoked, when it expires.

```bash
grackle channel revoke <grant-id>
```

The URL stops working immediately. A dead token knocks and the door stays shut.

## The scoping

This is the security story, and it is the whole point.

A channel token is a capability, not a login. It is signed and it carries exactly three things: the one channel it names, the one verb it permits, and the moment it dies. The server checks the signature, then checks the persisted grant — channel and verb must match on both sides — then it runs `send_input` and nothing else.

A narrow key that can do one thing to one session. Hand it to a CI job, a cron line, a third-party hook. If it leaks, it leaks the right to whisper into one running agent until its TTL runs out — or until you `revoke` it. Not your environments. Not your other sessions. Not your credentials.

Mint narrow. Set a TTL. Revoke when done.

---

- [Scheduled tasks](./scheduled-tasks) — trigger a session on a clock instead of a knock.
- [Credentials](../features/credentials) — every agent gets its own name and key.
- [Coordination](../features/coordination) — many agents, reporting back.
- [Tasks and sessions](../building-blocks/tasks-sessions) — what a session is, and what injecting input does to one.

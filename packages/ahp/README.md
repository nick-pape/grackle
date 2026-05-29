# @grackle-ai/ahp

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/ahp"><img src="https://img.shields.io/npm/v/@grackle-ai/ahp.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

[Agent Host Protocol](https://github.com/microsoft/agent-host-protocol) (AHP) type definitions and reducers, vendored for [Grackle](https://github.com/nick-pape/grackle).

AHP is Microsoft's open-source protocol for the wire format between an agent host and its clients: the JSON-RPC commands, the action envelopes that stream state changes, the notifications, and the pure reducers that fold those actions into derived session/terminal/changeset state. This package re-exports the canonical AHP TypeScript shapes and reducer functions so the rest of Grackle can depend on a single, version-pinned copy.

The source is **vendored**, not hand-maintained: a build-time prebuild script copies the `types/` tree from a pinned commit of the upstream repo, applies a small set of transforms, and writes it to `src/vendor/ahp/`. Do not edit the vendored files directly — change the pin or the transforms instead.

## Install

```bash
npm install @grackle-ai/ahp
```

## How the build works

The package builds in two steps, wired through Heft:

1. **Prebuild** (`scripts/prebuild.mjs`) — reads the upstream `types/` tree from `node_modules/agent-host-protocol/` (installed via the `agent-host-protocol` git dependency), applies the transforms below, and writes the result into `src/vendor/ahp/`:
   - Prepends an `/* eslint-disable -- vendored third-party code, see SOURCE.md */` header to every `.ts` file so upstream style does not trip the repo's lint rules (warnings fail CI).
   - Converts `const enum` to plain `enum` (a `const enum` is not reliably emitted across files by esbuild, so it would be `undefined` at runtime under the vitest runner).
   - Strips upstream `.test.ts` files and the upstream `tsconfig.json`.
   - Generates `src/vendor/ahp/SOURCE.md`, which records the pinned commit SHA and the transforms applied.
2. **Compile** — Heft compiles the vendored sources plus `src/index.ts` to `dist/`.

The reducer conformance corpus (`test-cases/reducers/*.json`) is kept and exercised by `src/reducer-conformance.test.ts`, which verifies the vendored reducers still match upstream's expected behavior.

## Key exports

All exports come through `src/index.ts`:

- **State types** — `RootState`, `SessionState`, `TerminalState`, `ChangesetState`, and the many supporting shapes (`AgentInfo`, `ToolCallState`, `UserMessage`, `SessionInputRequest`, etc.).
- **Enum values** (runtime constants) — `SessionStatus`, `SessionLifecycle`, `ToolCallStatus`, `ResponsePartKind`, `ChangesetStatus`, and friends.
- **Action types** — `ActionEnvelope`, `StateAction`, and the full set of root / session / terminal / changeset action shapes, plus the `ActionType` enum.
- **Command types** — JSON-RPC command params/results (`InitializeParams`, `CreateSessionParams`, `ResourceReadParams`, …) and command enums (`ReconnectResultType`, `ContentEncoding`, …).
- **Notification types** — `SessionAddedParams`, `AuthRequiredParams`, the OTLP export params, and the `AuthRequiredReason` enum.
- **Message types** — JSON-RPC envelopes and the `CommandMap` / notification-map types describing the protocol surface, plus `JsonRpcErrorCodes` / `AhpErrorCodes`.
- **Reducer functions** — `rootReducer`, `sessionReducer`, `terminalReducer`, `changesetReducer`, and the `softAssertNever` / `isClientDispatchable` helpers.

## Updating the upstream pin

The pinned upstream commit lives in **one place**: `devDependencies["agent-host-protocol"]` in `package.json`, as a `git+https://…#<sha>` spec. To move to a newer upstream commit:

1. Bump the SHA in `package.json` `devDependencies["agent-host-protocol"]`.
2. Run `rush update && rush build -t @grackle-ai/ahp`.
3. Confirm `src/vendor/ahp/SOURCE.md` shows the new SHA under **Pinned commit**.
4. Run `rush test -t @grackle-ai/ahp` to confirm the reducer conformance test still passes against the new corpus. If upstream changed reducer behavior or added/removed exports, update `src/index.ts` re-exports accordingly.

## Requirements

- Node.js >= 22 and < 24

## License

MIT (vendored AHP sources are MIT, © Microsoft Corporation)

# Vendored: Agent Host Protocol types

This directory is the `types/` tree cloned from Microsoft's Agent Host
Protocol repository, used by `@grackle-ai/ahp` - a publishable npm package
that builds from upstream via a prebuild transform step. It is third-party
code - **do not edit it directly**; update the pinned commit or transforms
in `scripts/prebuild.mjs` if upstream changes are needed.

- **Source:** https://github.com/microsoft/agent-host-protocol
- **Path:** `types/`
- **Pinned commit:** `7c6b727bde61bc2c490201fb0e47a86759172782`
  (`Add ahp-otlp: telemetry channel for OpenTelemetry pass-through (#140)`)
- **License:** MIT (C) Microsoft Corporation

## Local transforms (applied by `scripts/prebuild.mjs`)

1. A `/* eslint-disable -- vendored third-party code, see SOURCE.md */` header
   was prepended to every `.ts` file so the repo's `@rushstack` lint rules do
   not flag third-party style (warnings fail CI).
2. Upstream `.test.ts` files were removed (they run on `node:test`/`tsx`,
   which would conflict with this package's vitest runner). The reducer
   conformance corpus under `test-cases/reducers/*.json` is **kept** and
   exercised by `src/reducer-conformance.test.ts`.
3. The upstream `tsconfig.json` was removed; this package compiles the
   vendored sources under its own `tsconfig.json`.
4. Every `const enum` was converted to a plain `enum`. The string values
   are identical, but plain enums emit a runtime object, so they work both
   under tsc (heft build) and under esbuild (the vitest runner) - cross-file
   `const enum` access is not reliably emitted by esbuild and would be
   `undefined` at runtime.

The load-bearing pieces the package consumes: `reducers.ts` (re-exports the
pure channel reducers), `channels-session/{state,actions,reducer}.ts`,
`common/*`, and `action-origin.generated.ts`.

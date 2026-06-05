# Server Package Rules

- **New plugins self-register via `registerPlugin()` from `@grackle-ai/plugin-sdk`.** The server imports each plugin package (side-effect import triggers registration), then calls `resolveEnabledPlugins()` to build the plugin array. To add a new plugin: (1) create the package with a `registerPlugin()` call at module scope, (2) add a side-effect import in `server/src/index.ts`, (3) add the `workspace:*` dependency in `server/package.json`.

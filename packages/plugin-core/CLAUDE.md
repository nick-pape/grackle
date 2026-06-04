# Plugin Core Rules

- **Handlers are thin routing** — validate input, call a service, return the result. If your handler function exceeds ~40 lines, the business logic needs its own module.
- **Never import from a sibling plugin package.** If two plugins need the same logic, extract it to `common` or `plugin-sdk`.
- **Use `??` for all optional/default value handling, never `||`** (which swallows `""` and `0`).

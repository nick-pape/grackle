# Web Package Rules

- **Keep transport-layer types (`ConnectError`, gRPC `Code`) out of hooks and components.** Only `grackleError.ts` may import from `@connectrpc/connect` for error handling. All other hooks use `mapError()` / `extractErrorMessage()` from `grackleError.js`.
- **Presentational components must not call `useGrackle()`.** Data comes in via props. Route/layout components and `pages/**/*.tsx` wire the data layer.

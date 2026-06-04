# Web Package Rules

- **Keep transport-layer types (`ConnectError`, gRPC `Code`) out of presentational components.** Hooks that talk to the server may use them, but map to UI-friendly error types before passing to components.
- **Presentational components must not call `useGrackle()`.** Data comes in via props. Route/layout components and `pages/**/*.tsx` wire the data layer.

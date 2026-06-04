# Web Package Rules

- **No transport-layer types (`ConnectError`, gRPC `Code`) outside the data layer.** If you need error discrimination in a hook or component, use normalized UI error types.
- **Components in `components/` must not call `useGrackle()`.** Data comes in via props; only `pages/*.tsx` wires the data layer.

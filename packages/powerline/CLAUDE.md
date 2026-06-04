# PowerLine Package Rules

- **For any multi-step lifecycle (session, connection, forwarding), define an explicit state machine with typed states and validated transitions.** No boolean-flag state management.
- **New files must have a single concern.** If you're adding a new handler domain (auth, resources, channels), it gets its own file — don't append to an existing handlers file.

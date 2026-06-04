# Adapter SDK Rules

- **This package defines interfaces and shared utilities.** If your code references a specific adapter's infrastructure (codespace paths, docker hosts, SSH commands), it belongs in that adapter's package, not here.
- **No module-level mutable state (Maps, arrays, singletons).** Stateful objects must be instantiable and passed via context.

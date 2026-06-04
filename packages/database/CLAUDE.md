# Database Package Rules

- **Stores are pure data access.** If you're writing an `if` that isn't about query construction, it belongs in a service layer, not here.
- **Types exported from this package are persistence types.** Domain consumers should not import them directly — wrap or re-export through core.

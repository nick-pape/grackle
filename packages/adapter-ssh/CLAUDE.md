# SSH Adapter Rules

- **Before implementing a method, check if another adapter already has the same logic.** If so, extract to a shared base in adapter-sdk rather than duplicating.
- **All lifecycle operations (provision, connect, stop, destroy) must go through shared infrastructure (tunnel registry).** No parallel tracking in adapter-local globals.

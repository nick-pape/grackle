# Docker Adapter Rules

- **Before implementing a method, check if another adapter already has the same logic.** If so, extract to a shared base in adapter-sdk rather than duplicating.
- **All lifecycle operations (provision, connect, stop, destroy) must go through shared infrastructure (tunnel registry).** No parallel tracking in adapter-local globals. Attach mode is not special — it uses the same infrastructure as tunnel mode.

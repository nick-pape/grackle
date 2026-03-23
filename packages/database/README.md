# @grackle-ai/database

SQLite persistence layer for Grackle — schema definitions, store modules, migrations, and encrypted token storage.

## What it provides

- **Schema** — Drizzle ORM table definitions for environments, sessions, tasks, workspaces, findings, personas, settings, tokens, and domain events
- **Stores** — Focused CRUD modules for each entity (e.g., `sessionStore`, `taskStore`, `workspaceStore`)
- **Migrations** — Idempotent schema migrations that run on every startup
- **Seeding** — Application-level defaults (personas, root task, settings backfills)
- **Crypto** — AES-256-GCM encryption for token storage

## Usage

```typescript
import { openDatabase, initDatabase, seedDatabase, sqlite } from "@grackle-ai/database";
import * as sessionStore from "@grackle-ai/database/session-store";

// Initialize at startup
openDatabase();
initDatabase();
seedDatabase(sqlite!);

// Use stores
const session = sessionStore.getSession("session-123");
```

## Requirements

- Node.js >= 22
- `better-sqlite3` native module (built at install time)

## License

MIT

# @grackle-ai/plugin-scheduling

Scheduling plugin for Grackle. Provides:

- **Schedule CRUD handlers** — `createSchedule`, `listSchedules`, `getSchedule`, `updateSchedule`, `deleteSchedule` gRPC methods
- **Cron reconciliation phase** — fires due schedules on each tick, creates tasks, enqueues for dispatch
- **Schedule expression parsing** — interval shorthand (`30s`, `5m`, `1h`, `1d`) and standard 5-field cron syntax

## Usage

```typescript
import { createSchedulingPlugin } from "@grackle-ai/plugin-scheduling";
import { loadPlugins } from "@grackle-ai/plugin-sdk";

const plugins = await loadPlugins([createCorePlugin(), createSchedulingPlugin()], ctx);
```

The scheduling plugin declares `dependencies: ["core"]` so it is always loaded after the core plugin.

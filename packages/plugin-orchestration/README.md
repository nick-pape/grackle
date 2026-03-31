# @grackle-ai/plugin-orchestration

Orchestration plugin for Grackle — tasks, personas, findings, and escalations.

Separating orchestration from core means running Grackle without this plugin gives a clean "sessions + environments only" experience with no task DAG.

## Usage

```typescript
import { createCorePlugin } from "@grackle-ai/server/core-plugin";
import { createOrchestrationPlugin } from "@grackle-ai/plugin-orchestration";
import { loadPlugins } from "@grackle-ai/plugin-sdk";

const loaded = await loadPlugins(
  [createCorePlugin(), createOrchestrationPlugin()],
  pluginContext,
);
```

## What This Plugin Contributes

### gRPC Handlers (21 RPCs)

| Group | Methods |
|---|---|
| Tasks | `listTasks`, `createTask`, `getTask`, `updateTask`, `startTask`, `completeTask`, `setWorkpad`, `resumeTask`, `stopTask`, `deleteTask` |
| Personas | `listPersonas`, `createPersona`, `getPersona`, `updatePersona`, `deletePersona` |
| Findings | `postFinding`, `queryFindings`, `getFinding` |
| Escalations | `createEscalation`, `listEscalations`, `acknowledgeEscalation` |

### Reconciliation Phases

- **orphan-reparent** — re-parents child tasks whose parent session has ended

### Event Subscribers

- **sigchld** — handles agent process exit, updates task/session state
- **escalation-auto** — auto-detects and routes escalations to the notification system
- **orphan-reparent** — triggers reparenting on task lifecycle events

## Dependencies

Depends on the `"core"` plugin (declared via `dependencies: ["core"]`).

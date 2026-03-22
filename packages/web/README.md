# @grackle-ai/web

The Grackle web dashboard -- a single-page application for managing remote AI coding agents, environments, tasks, and workspaces. It connects to the Grackle server over WebSocket for real-time state updates and streams agent output as it happens.

![Dashboard with workspaces, active sessions, and task triage](../../screenshots/dashboard-projects-tasks.png)

## Features

- **Real-time agent streaming** -- watch tool calls, code output, and agent reasoning as they happen, bridged from gRPC through the server's WebSocket layer.
- **Task tree management** -- create, edit, and monitor hierarchical task trees with parent/child relationships, dependency gating, review/approval workflows, and inline findings.
- **DAG visualization** -- interactive dependency graph powered by React Flow, showing task hierarchy and dependency edges at a glance.
- **Environment management** -- add, configure, and monitor Docker, SSH, Local, and Codespace environments from a unified panel.
- **Workspace boards** -- group tasks and sessions around a shared repo and environment; track progress, cost, and session history per workspace.
- **Chat with the orchestrator** -- talk directly to the root agent through a chat interface with full access to every Grackle MCP tool.
- **Findings panel** -- browse categorized discoveries shared across agents within a workspace.
- **Persona management** -- create and configure specialized agent personas with custom runtimes, models, and system prompts.
- **Credential & token management** -- store and manage API keys and provider credentials from the Settings page.
- **10 built-in themes** -- Grackle, Grackle Light, Glassmorphism, Matrix, Neubrutalism, Monokai, Ubuntu, Sandstone, Verdigris, and Primer. Several themes offer light/dark variants. Switch in Settings or follow system preference.
- **Responsive layout** -- sidebar drawer with mobile breakpoints, keyboard shortcuts (Escape to close), and animated page transitions.
- **Setup wizard** -- guided onboarding flow for first-time users.

![Task tree with status indicators and expand/collapse](../../screenshots/task-tree-hierarchy.png)

![Live agent stream with tool calls and code output](../../screenshots/task-stream-view.png)

![Theme grid showing six built-in themes](../../screenshots/theme-grid.png)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 |
| Build | Vite 6 |
| Language | TypeScript (strict) |
| Styling | SCSS Modules + CSS custom properties (theme tokens) |
| Routing | React Router 7 |
| Animation | Motion (Framer Motion) |
| Graphs | React Flow + dagre |
| Markdown | react-markdown + remark-gfm + rehype-prism-plus |
| Testing | Vitest + React Testing Library |
| Shared types | `@grackle-ai/common` (protobuf-generated) |

## Development

```bash
# From the repo root -- install dependencies and build all packages
rush install && rush build

# Start the Vite dev server (hot-reload on port 5173)
cd packages/web
rushx dev
```

The dev server proxies `/ws` requests to `ws://localhost:3000`, so you need a running Grackle server for live data. Start one with:

```bash
# In another terminal
node packages/cli/dist/index.js serve
```

Then open http://localhost:5173.

### Build for production

```bash
rushx build      # TypeScript check + Vite production build → dist/
rushx preview    # Serve the production build locally
```

### Run tests

```bash
rushx test       # Vitest unit tests
```

### Mock mode

Append `?mock` to the URL (e.g., `http://localhost:5173/?mock`) to run the UI with a mock data provider instead of a live server connection. Useful for frontend development without a running backend.

## Project Structure

```
src/
  main.tsx              Entry point
  App.tsx               Root component, routing, context providers
  themes.ts             Theme registry (10 themes)
  context/              React contexts (Grackle state, Toast, Theme)
  hooks/                Custom hooks (WebSocket, sessions, tasks, environments, ...)
  pages/                Route-level page components
  components/
    layout/             AppNav, Sidebar, StatusBar, BottomStatusBar
    display/            EventStream, EventRenderer, SplashScreen, Spinner, ...
    panels/             TaskEditPanel, FindingsPanel, EnvironmentEditPanel, ...
    dag/                DagView, TaskNode (React Flow graph)
    chat/               ChatInput
    editable/           Inline-editable field components
    lists/              TaskList, EnvironmentNav
    workspace/          WorkspaceBoard
    personas/           PersonaManager
    notifications/      Toast, Callout
    settings/           SettingsNav
  styles/               Global SCSS, theme tokens, mixins
  utils/                Navigation helpers, dashboard computations
  mocks/                MockGrackleProvider for offline development
```

## License

MIT

# @grackle-ai/web-components

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/web-components"><img src="https://img.shields.io/npm/v/@grackle-ai/web-components.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Presentational React component library for the Grackle web UI, documented and developed in Storybook.

## Overview

`@grackle-ai/web-components` is the shared React 19 component library that powers the Grackle web dashboard. It contains the pure, presentational building blocks of the UI -- everything from buttons and toasts to the task tree, the dependency-graph view, and the full set of settings panels -- along with the contexts, hooks, types, and utilities they rely on.

Components accept data and callbacks as props and contain no direct server access, so they render the same in Storybook as they do in the live app. The library is consumed primarily by [`@grackle-ai/web`](https://github.com/nick-pape/grackle/tree/main/packages/web), which wires these components up to live server state. Shared protobuf-generated types come from [`@grackle-ai/common`](https://github.com/nick-pape/grackle/tree/main/packages/common).

## Install

```bash
npm install @grackle-ai/web-components
```

This library targets **React 19** (`react` and `react-dom` `^19`). It also pulls in the rendering dependencies it needs out of the box, including `@xyflow/react` and `@dagrejs/dagre` (graph views), `motion` (animation), `lucide-react` (icons), `react-router` (navigation helpers), and `react-markdown` + `remark-gfm` + `rehype-prism-plus` (Markdown rendering).

## What's Included

Components are grouped by area under `src/components/`:

| Category | Examples |
|----------|----------|
| **Display primitives** | `Button`, `SplitButton`, `CopyButton`, `Tooltip`, `Breadcrumbs`, `ConfirmDialog`, `Skeleton`, `Spinner`, `SplashScreen`, `FloatingActionBar` |
| **Event stream** | `EventStream`, `EventRenderer`, `EventHoverRow`, `SessionPicker`, `SessionAttemptSelector` |
| **MCP Apps widgets** | `widget` events render in a sandboxed iframe via `EventRenderer`/`EventStream` — pass `sandboxProxyUrl`. `EventRenderer` dispatches on the event's `rendererKind` (v1: `mcp-app-html` → `McpAppWidget`; unknown kinds fall back to the default card), so declarative renderers can be added without changing the contract. The host renderer `McpAppWidget` is loaded internally (lazy/code-split) and is **not** a value export; only its prop types (`McpAppWidgetProps`) and `grackleHostStyleVariables` are exported. |
| **Tool cards** | `ToolCard`, `FileEditCard`, `FileReadCard`, `ShellCard`, `SearchCard`, `TodoCard`, `MetadataCard`, `AgentToolCard`, `GenericToolCard` |
| **Layout** | `AppNav`, `Sidebar`, `StatusBar`, `BottomStatusBar` |
| **Lists** | `TaskList`, `EnvironmentNav`, `FindingsNav` |
| **DAG visualization** | `DagView`, `TaskNode`, `useDagLayout` (React Flow + dagre) |
| **Knowledge graph** | `KnowledgeGraph`, `KnowledgeDetailPanel`, `KnowledgeNav` |
| **Panels** | `TaskEditPanel`, `TaskOverviewPanel`, `EnvironmentEditPanel`, `FindingsPanel`, `TokensPanel`, `AppearancePanel`, `AboutPanel`, `PluginsPanel`, `GitHubAccountsPanel`, `CredentialProvidersPanel`, `KeyboardShortcutsPanel`, `WorkpadPanel` |
| **Editable fields** | `EditableTextField`, `EditableTextArea`, `EditableSelect`, `EditableCheckbox`, `EnvironmentSelect`, `useEditableField` |
| **Notifications** | `Toast`, `ToastContainer`, `Callout`, `UpdateBanner` |
| **Workspace & boards** | `WorkspaceBoard`, `WorkspaceFormFields` |
| **Personas & schedules** | `PersonaManager`, `McpToolSelector`, `ScheduleManager` |
| **Chat & coordination** | `ChatInput`, `CoordinationList`, `StreamDetailPanel` |
| **Settings** | `SettingsNav` |

Alongside the components, the package exports:

- **Contexts** -- `ToastProvider`, `ThemeProvider`, `SidebarProvider`, and `GrackleContext` with their hooks.
- **Hooks** -- `useSmartScroll`, `useEventSelection`, and shared domain types/guards from `hooks/types`.
- **Utilities** -- navigation URL builders, task-status styling, token/cost/time formatting, breadcrumb builders, session-event grouping, and dashboard KPI helpers.
- **Themes** -- the `THEMES` registry (`getThemeById`, `DEFAULT_THEME_ID`).
- **Mocks & test utilities** -- `MockGrackleProvider` plus Storybook decorators (`withMockGrackle`, `withMockGrackleRoute`).

The package entry point is `src/index.ts`; see it for the complete list of exports.

## Storybook

Every component ships with `.stories.tsx` stories, which serve as both the development environment and living documentation. The hosted Storybook is published to GitHub Pages at **https://nick-pape.github.io/grackle/components/**.

```bash
# From the package directory -- run Storybook locally on port 6006
rushx storybook

# Build the static Storybook site (output: storybook-static/)
rushx build-storybook

# Run Storybook interaction tests headlessly
rushx test-storybook
```

The Storybook base path is configurable via the `STORYBOOK_BASE` environment variable (defaults to `/`), which the publish workflow sets when deploying to GitHub Pages.

## Development

```bash
# From the repo root -- install dependencies and build all packages
rush install && rush build

# Build just this package (Heft)
rush build -t @grackle-ai/web-components
```

### Run tests

```bash
rushx test       # Vitest unit tests
```

## License

MIT

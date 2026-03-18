# UX Audit Skill

Performs a comprehensive User Experience audit of the Grackle web UI, producing a prioritized report of improvement proposals backed by screenshots.

## Invocation

```
/ux-audit
```

## What It Does

1. **Explore the codebase** — launch subagents in parallel to understand:
   - Web UI component structure, routing, navigation, layout (`packages/web/src/`)
   - Proto definitions and data model (`packages/common/proto/`, `packages/server/`)
   - All entity types, their fields, relationships, and status lifecycles
   - Forms, creation experiences, modals, and interaction patterns

2. **Launch the app in mock mode** — start the Vite dev server and open `http://localhost:<port>/?mock` using the Playwright MCP tools.

3. **Visually inspect every major state** — navigate through the UI using Playwright MCP (`browser_navigate`, `browser_click`, `browser_snapshot`, `browser_take_screenshot`) capturing screenshots of:
   - Landing / empty state
   - Each sidebar tab (Projects, Environments)
   - Project expanded with task tree
   - Every task status (pending, blocked, in_progress, review, done, failed)
   - Every task tab (Overview, Stream, Diff, Findings)
   - Project DAG view
   - Settings page
   - Every creation form (project, task, subtask, environment, token)
   - Any edge cases or surprising behaviors discovered

   Save screenshots to `screenshots/` with descriptive names.

4. **Analyze as a UX Designer** — put on a Product UX Designer hat and evaluate:
   - **Information architecture**: Does the navigation make sense? Is the hierarchy clear?
   - **Consistency**: Are creation patterns, action placements, and interaction models consistent?
   - **Discoverability**: Can users find features? Are empty states helpful?
   - **Efficiency**: Are common workflows streamlined? Any unnecessary clicks?
   - **Visual design**: Is space used well? Are important elements prominent?
   - **Completeness**: Are there data model fields not exposed in the UI? Missing CRUD operations?
   - **Standards compliance**: Does it follow common UI conventions?

5. **Write the report** — produce `specs/ux-audit.md` structured as:
   - Grouped by theme (Navigation, Workflows, Interaction Polish, Visual, Missing Features, Bugs)
   - Each item: **Current** state (with inline screenshot), **Problem** explanation, **Proposal**
   - Priority summary table at the end (P0/P1/P2/P3 with effort and impact)
   - Inline `![description](screenshots/filename.png)` image tags wherever screenshots are referenced
   - Minor bugs section at the end for issues discovered but not UX proposals

## Guidelines

- Focus on **UX improvements**, not deep architectural changes or new backend features.
- Think about "what could be better" based on "what is" — reorganizing, simplifying, adding missing affordances.
- Use subagents liberally for parallel code exploration to save context.
- Don't propose features that require significant backend changes — focus on what the UI layer can improve.
- Screenshots should capture the full viewport (1440x900) to show spatial relationships.
- When the Playwright MCP is available, prefer using it interactively over writing Playwright scripts.

## Prerequisites

- Playwright MCP server must be configured in `.mcp.json`
- `rush build -t @grackle-ai/web` should be up to date
- Dev server will be started automatically on an available port

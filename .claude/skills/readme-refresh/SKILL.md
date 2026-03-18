---
name: readme-refresh
description: Detect stale README content and screenshots, capture fresh screenshots from the live app, and draft README updates. Run with /readme-refresh.
---

# README Refresh — Automated Screenshot & Copy Update

This skill detects staleness in the project README and its screenshots, captures fresh screenshots from the running web UI, and drafts updated README content. It leaves all changes unstaged for the user to review.

## Step 1: Research Phase

Launch up to 3 Explore subagents **in parallel** to gather context:

### Agent A — Codebase & Features

Explore the current feature set by reading:
- `packages/web/src/` — UI components, routing, views, layout, feature flags
- `packages/server/` — server capabilities, adapters, API surface
- `packages/cli/` — CLI commands and options
- `packages/common/proto/` — proto definitions, services, message types

Produce a summary of all user-facing features and capabilities.

### Agent B — README & Screenshot Staleness

1. Read `README.md` in full — note every screenshot reference, feature claim, and section
2. List files in `screenshots/` and check their last-modified dates via `git log -1 --format="%ai" -- <file>` for each
3. Find the oldest screenshot commit date, then run:
   ```bash
   gh pr list --state merged --search "merged:>YYYY-MM-DD" --limit 100 --json number,title,mergedAt,labels
   ```
4. Summarize: which PRs are new since the last screenshot update, grouped by visual vs feature vs internal

### Agent C — RFC / Roadmap / Issues

Search for forward-looking context:
- Look for RFC, roadmap, or milestone docs in the repo (`specs/`, `RFC*.md`, `ROADMAP*`)
- Run `gh issue list --state open --limit 50 --json number,title,labels`
- Run `gh milestone list --json title,description` (if supported)
- Identify upcoming features the README could tease as "coming soon"

## Step 2: Diff Analysis

From Agent B's output, categorize the merged PRs into:

| Category | Action |
|----------|--------|
| **Visual changes** (new UI features, layout changes, new views) | Need new/recaptured screenshots |
| **Feature additions** (new capabilities, adapters, CLI commands) | Need README text updates |
| **Internal/infra** (refactors, CI, tests, tooling) | Skip — no README impact |

Produce a concrete plan:
1. **Screenshots to recapture** — existing ones that show stale UI
2. **New screenshots needed** — for features not yet represented in the README
3. **Text sections to update** — new features, changed features, removed claims
4. **Potential new sections** — for significant new capabilities not yet covered

Present this plan to the user with `AskUserQuestion` and get approval before proceeding.

## Step 3: Update Mock Data

The web UI's `?mock` mode is powered by mock data files that must reflect current features for screenshots to look realistic. If new features have been added since the mock data was last updated, update the mocks before capturing screenshots.

### Mock Data Architecture

| File | Purpose |
|------|---------|
| `packages/web/src/mocks/mockData.ts` | All entity definitions — projects, tasks, environments, sessions, session events, findings, tokens, personas, etc. |
| `packages/web/src/mocks/MockGrackleProvider.tsx` | Provider that implements `UseGrackleSocketResult` with interactive actions (spawn, kill, sendInput, startTask, etc.) |
| `packages/web/src/App.tsx` | Activates mock mode when `?mock` query param is present |

### What to Update

Compare the mock data entities against the current proto definitions and UI components from Step 1:

1. **New entity types** — If the codebase has new entity types (e.g., personas, notifications) that `mockData.ts` doesn't cover, add realistic sample data for them
2. **New fields on existing entities** — If existing types gained new fields (e.g., tasks got a `persona` field), populate them in the mock data so the UI renders them
3. **New actions in MockGrackleProvider** — If the real `GrackleProvider` gained new methods the mock doesn't implement, add stub implementations that return realistic results
4. **Stale data** — If mock data references removed features or uses outdated field names, update it to match current types

### Guidelines

- Mock data should look like a **realistic demo** — use descriptive project names, varied task statuses, and enough items to show the UI's capabilities without overwhelming it
- Ensure data relationships are consistent (e.g., a task's `environmentId` references an environment that exists in the mock data)
- Add enough variety to showcase each feature: multiple statuses, different adapter types, various persona configurations, etc.
- Use the same type conventions as the existing mock data — the web app models statuses as plain strings, so match that style rather than importing proto enums

## Step 4: Build & Launch App

```bash
rush build -t @grackle-ai/web
```

Start the Vite dev server. Find the port from output (usually 5173 or similar), then open the app in mock mode using Playwright MCP:

```
http://localhost:<port>/?mock
```

The `?mock` query parameter loads realistic demo data without requiring a running Grackle server.

## Step 5: Capture Screenshots

Use Playwright MCP to navigate through the app and capture screenshots.

### Setup
- Resize browser to **1440x900** for consistent framing: `mcp__playwright__browser_resize` with width=1440, height=900
- Check existing screenshots to determine the theme (dark/light) — match it for consistency

### Capture Process

For each screenshot identified in Step 2:

1. **Navigate** to the correct view using `mcp__playwright__browser_navigate` and `mcp__playwright__browser_click`
2. **Set up state** — expand trees, select tabs, ensure the UI shows representative data
3. **Wait** for any animations or loading to settle: `mcp__playwright__browser_wait_for`
4. **Verify** with `mcp__playwright__browser_snapshot` that the page is in the right state
5. **Capture** with `mcp__playwright__browser_take_screenshot`, saving to `screenshots/<name>.png`

### Naming Convention
- Use **kebab-case** descriptive filenames matching the existing convention
- Examples: `dashboard-projects-tasks.png`, `task-tree-hierarchy.png`, `persona-management-view.png`

### Quality Checks
- No transient UI (tooltips, loading spinners, hover states) unless that's the feature being shown
- The UI should show populated, realistic data — not empty states (unless capturing the empty state CTA)
- Ensure text is readable and the key feature is prominent in the frame

## Step 6: Draft README Updates

Edit `README.md` with a **sales pitch** tone — this is marketing, not documentation:

### Guidelines
- **Update** existing screenshot references if images were recaptured (same path, new content)
- **Add** new screenshot references with descriptive alt text for new features
- **Update** the Features table / Philosophy section with new capabilities
- **Refresh** environment/adapter references if new adapters were added
- **Add or update** "coming soon" teasers based on Agent C's findings
- **Keep the tone** punchy and benefit-oriented: "what can you do" not "what did we build"
- **Don't bloat** — the README should stay scannable. One screenshot per major feature area is enough.

### What NOT to change
- Don't rewrite sections that are still accurate
- Don't change the Mermaid diagrams unless the architecture actually changed

### Issue Links
The README uses `[⭐#N]` links to reference GitHub issues as roadmap callouts. Update these:
- **Merged/closed issues**: Remove the link — the feature is shipped, describe it as a real capability instead of a teaser
- **Open issues for planned features**: Keep or add links — these signal the roadmap to readers

## Step 7: Present Changes for Review

Show the user a summary:
- **Screenshots**: Which were recaptured vs newly added, with before/after if applicable
- **Text changes**: Brief description of what was updated in the README
- **Suggestions**: Any additional improvements the user might want to make manually
- **Skipped items**: PRs or features that were intentionally not added to the README, and why

**Do NOT commit.** Leave all changes as unstaged modifications for the user to review and commit themselves.

## Prerequisites

- Playwright MCP server must be configured
- `rush build -t @grackle-ai/web` must succeed
- `gh` CLI must be authenticated (for PR/issue queries)
- `screenshots/` directory must exist

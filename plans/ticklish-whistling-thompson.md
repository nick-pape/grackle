# Plan: Pin the Settings tab to the far-right of the top nav

## Context

The top navigation bar (`AppNav`) renders its tabs in **plugin order**, not in the
canonical `TABS` order. `App.tsx:155` builds the tab list with
`buildTabs(pluginNames)` (`packages/web/src/plugin-registry.tsx:65`), which flattens
each active plugin's `navItems` in sequence:

- `core` → Dashboard, Chat, Environments, **Settings**
- `orchestration` → Tasks, Findings
- `knowledge` → Knowledge

So in the live app Settings lands at position 4 — _before_ Tasks/Findings/Knowledge —
even though `TABS` in `AppNav.tsx:34` lists Settings last. Because
`AppNav.module.scss:7` uses a plain left-packed `display: flex` with no
`margin-left: auto`, Settings simply renders wherever its index falls, and its
horizontal position shifts whenever the active plugin set changes.

**Goal:** Settings should always sit flush against the **right edge** of the nav bar,
regardless of which plugins are active (user-confirmed: far-right edge with a gap, the
conventional "settings on the right" pattern).

The fix lives in the presentational `AppNav` component (in `@grackle-ai/web-components`)
so it holds for every caller — the live app, Storybook, and tests — without leaking
view-specific knowledge into the plugin registry.

## Approach

Mark the Settings tab as right-aligned via a data-driven `align: "end"` flag, then have
`AppNav` (a) render end-aligned tabs last in DOM order and (b) push the first
end-aligned tab to the right with `margin-left: auto`. This is robust to any plugin
combination and keeps a single source of truth in `TABS`.

### 1. `packages/web-components/src/components/layout/AppNav.tsx`

- Extend the `AppTab` interface (after line 23) with an optional alignment field:
  ```ts
  /** Horizontal alignment within the nav bar. `"end"` pins the tab to the right edge. */
  align?: "end";
  ```
- Set `align: "end"` on the `settings` entry in `TABS` (line 34).
- Add `useMemo` to the React import (line 1).
- In the component, compute a stable reordered list so end-aligned tabs always come
  last (their relative order preserved), and find the first end-aligned view to receive
  the spacer:
  ```ts
  const orderedTabs = useMemo(
    () => [...tabs.filter((t) => t.align !== "end"), ...tabs.filter((t) => t.align === "end")],
    [tabs],
  );
  const firstEndAlignedView = orderedTabs.find((t) => t.align === "end")?.view;
  ```
- Use `orderedTabs` everywhere `tabs` is currently used for rendering and keyboard nav
  (the `.map` at line 111 and the `handleKeyDown` references at lines 78, 83, 86, 92, 97)
  so DOM order, focus order, and arrow/J-K/Home/End navigation all agree.
- In the `.map`, add the spacer class to the first end-aligned tab:
  ```tsx
  className={`${styles.tab} ${tab.view === firstEndAlignedView ? styles.tabEnd : ""} ${isActive ? styles.tabActive : ""}`}
  ```

### 2. `packages/web-components/src/components/layout/AppNav.module.scss`

- Add a spacer rule that absorbs free space to the left of the pinned tab:
  ```scss
  .tabEnd {
    margin-left: auto;
  }
  ```
  This is inert on mobile (the nav is `overflow-x: auto` and content-width, so there is
  no free space to absorb), so existing mobile horizontal-scroll behavior is unaffected.

### 3. `packages/web-components/src/components/layout/AppNav.stories.tsx`

- Add a `SettingsPinnedRight` story that passes a tabs array mimicking real
  `buildTabs` output (Settings _not_ last in the input, e.g. Dashboard, Chat,
  Environments, Settings, Tasks, Findings, Knowledge). The `play` function asserts
  that the **last** rendered tab is Settings — i.e. assert on DOM order, not just
  presence:
  ```ts
  const renderedTabs = canvas.getAllByRole("tab");
  await expect(renderedTabs[renderedTabs.length - 1]).toHaveAccessibleName(/Settings/);
  ```
- The existing `KeyboardNavigation` / `JKNavigation` stories use the default `TABS`
  (Settings already last there), so reordering is a no-op for them and they keep
  passing. Verify they still pass after the change.

### Notes / non-goals

- **No change to `plugin-registry.tsx` / `buildTabs`.** Reordering stays in the
  presentation layer so the registry remains free of view-specific layout rules.
- `SettingsNav` (the vertical sub-nav _inside_ the Settings page) is unrelated and
  untouched.

## Critical files

| File                                                               | Change                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web-components/src/components/layout/AppNav.tsx`         | `align` field on `AppTab`, `align: "end"` on Settings, `orderedTabs` memo, spacer class wiring, keyboard-nav uses `orderedTabs` |
| `packages/web-components/src/components/layout/AppNav.module.scss` | new `.tabEnd { margin-left: auto; }`                                                                                            |
| `packages/web-components/src/components/layout/AppNav.stories.tsx` | new `SettingsPinnedRight` story asserting DOM order                                                                             |

## Tests

- **Storybook interaction tests** (per CLAUDE.md, pure-component layout/behavior belongs
  in Storybook, not E2E):
  - New `SettingsPinnedRight` story asserts Settings renders last given out-of-order
    input.
  - Re-run existing AppNav stories (`AllTabsRendered`, `CoreOnlyTabs`,
    `AllTabsExplicit`, `KeyboardNavigation`, `JKNavigation`, `AriaAttributes`) to
    confirm no regressions.

## Verification

1. Build the package:
   ```
   rush build -t @grackle-ai/web-components
   ```
   Treat "succeeded with warnings" as failure — fix any warnings.
2. Run the Storybook interaction tests for AppNav (per the Storybook section in
   CLAUDE.md: `npm run build-storybook` then `test-storybook`) and confirm the new
   story and all existing AppNav stories pass.
3. Manual visual check with `/launch-grackle` + Playwright MCP:
   - Open the web UI, navigate across Dashboard, Tasks, Findings, Knowledge, and
     Settings pages.
   - Confirm the ⚙ Settings tab stays flush against the right edge of the nav bar on
     every page (gap between it and the other tabs), and that clicking it still routes
     to Settings.
   - Take a screenshot and read it back with the Read tool to visually confirm
     positioning.
4. Open a PR with `/create-pr` (it links the issue, generates the required lockstep
   change file, and captures screenshots).

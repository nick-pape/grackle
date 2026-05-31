import { useCallback, useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { Code2, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { ICON_LG } from "../../utils/iconSize.js";
import { Tooltip } from "../display/Tooltip.js";
import styles from "./ContextNav.module.scss";

/** A single selectable context in the {@link ContextNav} rail. */
export interface ContextItem {
  /** Stable identifier (e.g. `"code"`). */
  id: string;
  /** Display label. */
  label: string;
  /** Icon element rendered before the label. */
  icon: ReactNode;
  /** `data-testid` for the context's button (e.g. `"context-code"`). */
  testId: string;
}

/** Identifier of the default `Code` context (the only context in Phase 0). */
export const DEFAULT_CONTEXT_ID: string = "code";

/**
 * Accessible name shared by the `<nav>` landmark and its `tablist`. The landmark
 * names the region; the tablist needs its own name so assistive tech announces a
 * named tab list (and so `getByRole("tablist")` can find it by label).
 */
const CONTEXT_NAV_LABEL: string = "Context navigation";

/**
 * Canonical list of contexts, co-located with the component like {@link TABS}
 * so icons/ids/test-ids stay a single source of truth. Phase 0 ships only
 * `Code` (#1414); Agent rows are appended dynamically in #1417.
 */
export const CONTEXTS: ContextItem[] = [
  {
    id: DEFAULT_CONTEXT_ID,
    label: "Code",
    icon: <Code2 size={ICON_LG} />,
    testId: "context-code",
  },
];

/** Props for the {@link ContextNav} component. */
export interface ContextNavProps {
  /** Contexts to list, in display order. */
  contexts: ContextItem[];
  /** Identifier of the currently active context. */
  activeContextId: string;
  /** Called with a context id when the user selects it. */
  onSelectContext: (id: string) => void;
  /** When `true`, the rail shows icons only (labels move into tooltips). */
  collapsed?: boolean;
  /** Called when the user toggles the collapsed state. Omit to hide the toggle. */
  onToggleCollapsed?: () => void;
  /** Called when the user clicks "Create Agent". Omit to hide the affordance. */
  onCreateAgent?: () => void;
  /**
   * Fleet/overview items rendered in a section **above** the contexts — the
   * cross-context altitude (e.g. Coordination, #1415). Unlike contexts, these
   * navigate to a route, so the parent maps each id back to its destination.
   * Omit or pass an empty array to render no Fleet section.
   */
  fleetItems?: ContextItem[];
  /** Identifier of the active fleet item, if any (route-derived by the parent). */
  activeFleetId?: string;
  /** Called with a fleet item id when selected (the parent navigates to its route). */
  onSelectFleet?: (id: string) => void;
}

/**
 * Vertical left rail for the **context axis** (#1414) — the outermost level of
 * the context → view → detail navigation spine. Lists the contexts the user can
 * enter (just `Code` today; Agent rows arrive in #1417) and is purely
 * presentational: it takes the active id plus selection/toggle callbacks and
 * never touches the router or `useGrackle`.
 *
 * An optional **Fleet** section sits above the contexts for cross-context
 * overview surfaces (Coordination, #1415). Those items navigate to a route, so
 * they render as plain buttons (not `tab`s) and stay out of the context
 * `tablist`'s roving-tabindex group.
 *
 * Implements a vertical `tablist` with automatic activation — arrow keys move
 * focus and select in one step, mirroring {@link AppNav}'s horizontal behavior.
 */
export function ContextNav({
  contexts,
  activeContextId,
  onSelectContext,
  collapsed = false,
  onToggleCollapsed,
  onCreateAgent,
  fleetItems,
  activeFleetId,
  onSelectFleet,
}: ContextNavProps): JSX.Element {
  const createAgentLabel = "Create Agent";
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : contexts.findIndex((c) => c.id === activeContextId);
      let nextIndex = currentIndex;

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % contexts.length;
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + contexts.length) % contexts.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = contexts.length - 1;
      } else {
        return;
      }

      onSelectContext(contexts[nextIndex].id);
      buttons[nextIndex]?.focus(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- index may be out of bounds
    },
    [activeContextId, contexts, onSelectContext],
  );

  return (
    <nav
      className={styles.rail}
      aria-label={CONTEXT_NAV_LABEL}
      data-testid="context-nav"
      data-collapsed={collapsed}
    >
      {fleetItems && fleetItems.length > 0 && (
        <div className={styles.fleetSection}>
          {!collapsed && <span className={styles.sectionLabel}>Fleet</span>}
          <div className={styles.fleetList} role="list" aria-label="Fleet overview">
            {fleetItems.map((item) => {
              const isActive = item.id === activeFleetId;
              const button = (
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                  onClick={() => onSelectFleet?.(item.id)}
                  data-testid={item.testId}
                  aria-label={item.label}
                >
                  <span className={styles.tabIcon} aria-hidden="true">
                    {item.icon}
                  </span>
                  {!collapsed && <span className={styles.tabLabel}>{item.label}</span>}
                </button>
              );
              // Each item is a `listitem` so the `role="list"` has valid children.
              // When collapsed, labels live in a tooltip so the rail stays icon-only.
              return (
                <div key={item.id} role="listitem" className={styles.tabWrapper}>
                  {collapsed ? (
                    <Tooltip text={item.label} placement="right" inline={false}>
                      {button}
                    </Tooltip>
                  ) : (
                    button
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div
        className={styles.tabList}
        ref={tabListRef}
        role="tablist"
        aria-label={CONTEXT_NAV_LABEL}
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
      >
        {contexts.map((context) => {
          const isActive = context.id === activeContextId;
          const button = (
            <button
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => onSelectContext(context.id)}
              data-testid={context.testId}
              aria-label={context.label}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                {context.icon}
              </span>
              {!collapsed && <span className={styles.tabLabel}>{context.label}</span>}
            </button>
          );
          // When collapsed, labels live in a tooltip so the rail stays icon-only.
          return collapsed ? (
            <Tooltip key={context.id} text={context.label} placement="right" inline={false}>
              {button}
            </Tooltip>
          ) : (
            <div key={context.id} className={styles.tabWrapper}>
              {button}
            </div>
          );
        })}
        {onCreateAgent &&
          (collapsed ? (
            <Tooltip text={createAgentLabel} placement="right" inline={false}>
              <button
                type="button"
                className={styles.createAgent}
                onClick={onCreateAgent}
                aria-label={createAgentLabel}
                data-testid="context-nav-create-agent"
              >
                <span className={styles.tabIcon} aria-hidden="true">
                  <Plus size={ICON_LG} />
                </span>
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              className={styles.createAgent}
              onClick={onCreateAgent}
              aria-label={createAgentLabel}
              data-testid="context-nav-create-agent"
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <Plus size={ICON_LG} />
              </span>
              <span className={styles.tabLabel}>{createAgentLabel}</span>
            </button>
          ))}
      </div>

      {onToggleCollapsed && (
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand context navigation" : "Collapse context navigation"}
          aria-expanded={!collapsed}
          data-testid="context-nav-toggle"
        >
          <span className={styles.tabIcon} aria-hidden="true">
            {collapsed ? <PanelLeftOpen size={ICON_LG} /> : <PanelLeftClose size={ICON_LG} />}
          </span>
          {!collapsed && <span className={styles.tabLabel}>Collapse</span>}
        </button>
      )}
    </nav>
  );
}

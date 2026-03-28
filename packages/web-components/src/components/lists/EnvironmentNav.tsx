import { useCallback, useRef, type JSX, type KeyboardEvent } from "react";
import { Circle } from "lucide-react";
import { useMatch } from "react-router";
import type { Environment } from "../../hooks/types.js";
import { environmentUrl, NEW_ENVIRONMENT_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./EnvironmentNav.module.scss";

/** Status-dot color mapping using CSS custom properties. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

/** Props for the EnvironmentNav component. */
interface EnvironmentNavProps {
  /** List of all environments to display in the nav. */
  environments: Environment[];
}

/** Vertical nav rail listing environments with status dots. */
export function EnvironmentNav({ environments }: EnvironmentNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const envMatch = useMatch("/environments/:environmentId");
  const editMatch = useMatch("/environments/:environmentId/edit");
  const workspaceMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId");
  const workspaceSubMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/*");
  const rawId = envMatch?.params.environmentId ?? editMatch?.params.environmentId
    ?? workspaceMatch?.params.environmentId ?? workspaceSubMatch?.params.environmentId;
  /** Filter out the "new" pseudo-ID so /environments/new doesn't highlight a real tab. */
  const activeId = rawId === "new" ? undefined : rawId;

  const handleClick = useCallback((envId: string) => {
    navigate(environmentUrl(envId));
  }, [navigate]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!buttons || buttons.length === 0) {
      return;
    }
    const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : environments.findIndex((env) => env.id === activeId);
    let nextIndex = currentIndex;

    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = buttons.length - 1;
    } else {
      return;
    }

    if (nextIndex < environments.length) {
      navigate(environmentUrl(environments[nextIndex].id));
    }
    buttons[nextIndex].focus();
  }, [activeId, environments, navigate]);

  /** When no environment is selected, the first tab should be focusable. */
  const focusableId = activeId ?? (environments.length > 0 ? environments[0].id : undefined);

  return (
    <div className={styles.nav} data-testid="environment-nav">
      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Environments"
        onKeyDown={handleKeyDown}
      >
        {environments.map((env) => {
          const isActive = env.id === activeId;
          const isFocusable = env.id === focusableId;
          const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
          const isConnected = env.status === "connected";
          return (
            <button
              key={env.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isFocusable ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => handleClick(env.id)}
              data-testid="env-nav-item"
            >
              <span
                className={`${styles.statusDot} ${isConnected ? styles.pulse : ""}`}
                style={{ color: statusColor }}
              >
                <Circle size={8} fill="currentColor" />
              </span>
              <span className={styles.tabLabel} title={env.displayName || env.id}>
                {env.displayName || env.id}
              </span>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className={styles.addButton}
        onClick={() => navigate(NEW_ENVIRONMENT_URL)}
        title="Add environment"
        data-testid="env-nav-add"
      >
        + Add Environment
      </button>

      {environments.length === 0 && (
        <div className={styles.empty}>
          No environments yet.
        </div>
      )}
    </div>
  );
}

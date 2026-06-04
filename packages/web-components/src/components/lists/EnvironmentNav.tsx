/**
 * EnvironmentNav -- vertical sidebar navigation for the Environments page.
 *
 * @module
 */

import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Circle, Filter, Layers, Plus } from "lucide-react";
import { ICON_XS, ICON_MD } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { Environment } from "../../hooks/types.js";
import { environmentUrl, NEW_ENVIRONMENT_URL, useAppNavigate } from "../../utils/navigation.js";
import { SectionHeader, type SectionHeaderAction } from "../display/SectionHeader.js";
import { FilterDropdown, type FilterDropdownGroup } from "../display/FilterDropdown.js";
import { useFilterGroupSort } from "../../hooks/useFilterGroupSort.js";
import styles from "./EnvironmentNav.module.scss";

/** Status-dot color mapping using CSS custom properties. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

/** Human-readable labels for status values. */
const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  sleeping: "Sleeping",
  error: "Error",
  disconnected: "Disconnected",
  connecting: "Connecting",
};

/** Human-readable labels for adapter types. */
const TYPE_LABELS: Record<string, string> = {
  local: "Local",
  ssh: "SSH",
  codespace: "Codespace",
  docker: "Docker",
};

/** Props for the EnvironmentNav component. */
interface EnvironmentNavProps {
  /** List of all environments to display in the nav. */
  environments: Environment[];
}

/** Vertical nav rail listing environments with status dots, filter, and grouping. */
export function EnvironmentNav({ environments }: EnvironmentNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const envMatch = useMatch("/environments/:environmentId");
  const editMatch = useMatch("/environments/:environmentId/edit");
  const workspaceMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId");
  const workspaceSubMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/*");
  const rawId =
    envMatch?.params.environmentId ??
    editMatch?.params.environmentId ??
    workspaceMatch?.params.environmentId ??
    workspaceSubMatch?.params.environmentId;
  const activeId = rawId === "new" ? undefined : rawId;

  const {
    filterValues,
    filterActive,
    toggleFilter,
    clearFilter,
    groupBy,
    groupActive,
    toggleGroup,
    clearGroup,
  } = useFilterGroupSort({ storagePrefix: "grackle-env-nav" });

  const [filterOpen, setFilterOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  // ── Filter groups (single-level, all dimensions at once) ────────
  const filterGroups = useMemo<FilterDropdownGroup[]>(() => {
    const statuses = [...new Set(environments.map((e) => e.status))].sort();
    const types = [...new Set(environments.map((e) => e.adapterType))].sort();
    return [
      {
        label: "Status",
        options: statuses.map((s) => ({ key: `status:${s}`, label: STATUS_LABELS[s] || s })),
      },
      {
        label: "Type",
        options: types.map((t) => ({ key: `type:${t}`, label: TYPE_LABELS[t] || t })),
      },
    ];
  }, [environments]);

  const groupOptions = useMemo(
    () => [
      { key: "status", label: "By Status" },
      { key: "type", label: "By Type" },
    ],
    [],
  );

  // ── Filtered environments ───────────────────────────────────────
  const filtered = useMemo(() => {
    if (!filterActive) {
      return environments;
    }
    const statusFilters = new Set<string>();
    const typeFilters = new Set<string>();
    for (const k of filterValues) {
      if (k.startsWith("status:")) {
        statusFilters.add(k);
      } else if (k.startsWith("type:")) {
        typeFilters.add(k);
      }
    }
    return environments.filter((env) => {
      const passesStatus = statusFilters.size === 0 || statusFilters.has(`status:${env.status}`);
      const passesType = typeFilters.size === 0 || typeFilters.has(`type:${env.adapterType}`);
      return passesStatus && passesType;
    });
  }, [environments, filterActive, filterValues]);

  // ── Grouped environments ────────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupActive) {
      return [{ id: "__all__", label: "", environments: filtered }];
    }
    const map = new Map<string, Environment[]>();
    for (const env of filtered) {
      const key = groupBy === "status" ? env.status : env.adapterType;
      const existing = map.get(key);
      if (existing) {
        existing.push(env);
      } else {
        map.set(key, [env]);
      }
    }
    const labels = groupBy === "status" ? STATUS_LABELS : TYPE_LABELS;
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, envs]) => ({ id: key, label: labels[key] || key, environments: envs }));
  }, [filtered, groupActive, groupBy]);

  // ── Header actions ──────────────────────────────────────────────
  const headerActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "filter",
        icon: <Filter size={ICON_MD} />,
        tooltip: filterActive ? "Filter active" : "Filter",
        ariaLabel: "Filter environments",
        onClick: () => {
          setFilterOpen((p) => !p);
          setGroupOpen(false);
        },
        active: filterActive,
        ariaHasPopup: true,
        ariaExpanded: filterOpen,
        testId: "env-nav-filter",
      },
      {
        key: "group",
        icon: <Layers size={ICON_MD} />,
        tooltip: groupActive ? `Grouped by ${groupBy}` : "Group",
        ariaLabel: "Group environments",
        onClick: () => {
          setGroupOpen((p) => !p);
          setFilterOpen(false);
        },
        active: groupActive,
        ariaHasPopup: true,
        ariaExpanded: groupOpen,
        testId: "env-nav-group",
      },
      {
        key: "add",
        icon: <Plus size={ICON_MD} />,
        tooltip: "Add environment",
        ariaLabel: "Add environment",
        onClick: () => navigate(NEW_ENVIRONMENT_URL),
        testId: "env-nav-add-header",
      },
    ],
    [filterActive, filterOpen, groupActive, groupOpen, groupBy, navigate],
  );

  // ── Keyboard nav ────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const flatEnvs = groups.flatMap((g) => g.environments);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : flatEnvs.findIndex((env) => env.id === activeId);
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

      const flatList = groups.flatMap((g) => g.environments);
      if (nextIndex < flatList.length) {
        navigate(environmentUrl(flatList[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, groups, navigate],
  );

  const flatEnvs = groups.flatMap((g) => g.environments);
  const activeInList = activeId && flatEnvs.some((e) => e.id === activeId);
  const focusableId =
    (activeInList ? activeId : undefined) ?? (flatEnvs.length > 0 ? flatEnvs[0].id : undefined);

  const handleClick = useCallback(
    (envId: string) => {
      navigate(environmentUrl(envId));
    },
    [navigate],
  );

  return (
    <div className={styles.container} data-testid="environment-nav">
      <div className={styles.headerWrapper}>
        <SectionHeader title="Environments" actions={headerActions} data-testid="env-nav-header" />
        {filterOpen && (
          <FilterDropdown
            groups={filterGroups}
            selected={filterValues}
            onToggle={toggleFilter}
            onClear={clearFilter}
            onClose={() => setFilterOpen(false)}
            data-testid="env-nav-filter-dropdown"
          />
        )}
        {groupOpen && (
          <FilterDropdown
            options={groupOptions}
            selected={new Set(groupBy ? [groupBy] : [])}
            onToggle={(key) => {
              toggleGroup(key);
              setGroupOpen(false);
            }}
            onClear={() => {
              clearGroup();
              setGroupOpen(false);
            }}
            onClose={() => setGroupOpen(false)}
            data-testid="env-nav-group-dropdown"
          />
        )}
      </div>

      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Environments"
        onKeyDown={handleKeyDown}
        className={styles.nav}
      >
        {groups.map((group) => (
          <div key={group.id}>
            {group.label && (
              <div className={styles.groupLabel} data-testid={`env-nav-group-${group.id}`}>
                {group.label}
              </div>
            )}
            {group.environments.map((env) => {
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
                    aria-hidden="true"
                  >
                    <Circle size={ICON_XS} fill="currentColor" />
                  </span>
                  <span className={styles.tabLabel} title={env.displayName || env.id}>
                    {env.displayName || env.id}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
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

      {filtered.length === 0 && environments.length > 0 && (
        <div className={styles.empty}>No matching environments.</div>
      )}
      {environments.length === 0 && <div className={styles.empty}>No environments yet.</div>}
    </div>
  );
}

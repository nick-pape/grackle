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
import { FilterDropdown } from "../display/FilterDropdown.js";
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

/** localStorage keys for persisting filter/group state. */
const STORAGE_KEY_FILTER: string = "grackle-env-nav-filter";
const STORAGE_KEY_GROUP: string = "grackle-env-nav-group";

/** Read persisted filter state. */
function loadFilter(): { field: string; values: Set<string> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FILTER);
    if (raw) {
      const parsed = JSON.parse(raw) as { field: string; values: string[] };
      return { field: parsed.field, values: new Set(parsed.values) };
    }
  } catch {
    /* ignore */
  }
  return { field: "", values: new Set() };
}

/** Persist filter state. */
function saveFilter(field: string, values: Set<string>): void {
  try {
    if (values.size === 0) {
      localStorage.removeItem(STORAGE_KEY_FILTER);
    } else {
      localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify({ field, values: [...values] }));
    }
  } catch {
    /* ignore */
  }
}

/** Read persisted group-by. */
function loadGroupBy(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_GROUP) ?? "";
  } catch {
    return "";
  }
}

/** Persist group-by. */
function saveGroupBy(value: string): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY_GROUP, value);
    } else {
      localStorage.removeItem(STORAGE_KEY_GROUP);
    }
  } catch {
    /* ignore */
  }
}

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

  // ── Filter state ────────────────────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterField, setFilterField] = useState(() => loadFilter().field);
  const [filterValues, setFilterValues] = useState(() => loadFilter().values);

  // ── Group-by state ──────────────────────────────────────────────
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupBy, setGroupBy] = useState(loadGroupBy);

  const filterActive = filterValues.size > 0;
  const groupActive = groupBy !== "";

  const filterOptions = useMemo(() => {
    if (filterField === "status") {
      const unique = [...new Set(environments.map((e) => e.status))].sort();
      return unique.map((s) => ({ key: s, label: STATUS_LABELS[s] || s }));
    }
    if (filterField === "type") {
      const unique = [...new Set(environments.map((e) => e.adapterType))].sort();
      return unique.map((t) => ({ key: t, label: TYPE_LABELS[t] || t }));
    }
    return [
      { key: "status", label: "By Status" },
      { key: "type", label: "By Type" },
    ];
  }, [filterField, environments]);

  const groupOptions = useMemo(
    () => [
      { key: "status", label: "By Status" },
      { key: "type", label: "By Type" },
    ],
    [],
  );

  const handleFilterToggle = useCallback(
    (key: string) => {
      if (!filterField) {
        setFilterField(key);
        return;
      }
      setFilterValues((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        saveFilter(filterField, next);
        return next;
      });
    },
    [filterField],
  );

  const handleFilterClear = useCallback(() => {
    setFilterField("");
    setFilterValues(new Set());
    saveFilter("", new Set());
  }, []);

  const handleGroupToggle = useCallback((key: string) => {
    setGroupBy((prev) => {
      const next = prev === key ? "" : key;
      saveGroupBy(next);
      setGroupOpen(false);
      return next;
    });
  }, []);

  // ── Filtered environments ───────────────────────────────────────
  const filtered = useMemo(() => {
    if (!filterActive) {
      return environments;
    }
    return environments.filter((env) => {
      if (filterField === "status") {
        return filterValues.has(env.status);
      }
      if (filterField === "type") {
        return filterValues.has(env.adapterType);
      }
      return true;
    });
  }, [environments, filterActive, filterField, filterValues]);

  // ── Grouped environments ────────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupActive) {
      return [{ label: "", environments: filtered }];
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
      .map(([key, envs]) => ({ label: labels[key] || key, environments: envs }));
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
    [filterActive, groupActive, groupBy, navigate],
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
  const focusableId = activeId ?? (flatEnvs.length > 0 ? flatEnvs[0].id : undefined);

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
            options={filterOptions}
            selected={filterField ? filterValues : new Set<string>()}
            onToggle={handleFilterToggle}
            onClear={handleFilterClear}
            onClose={() => setFilterOpen(false)}
            data-testid="env-nav-filter-dropdown"
          />
        )}
        {groupOpen && (
          <FilterDropdown
            options={groupOptions}
            selected={new Set(groupBy ? [groupBy] : [])}
            onToggle={handleGroupToggle}
            onClear={() => {
              setGroupBy("");
              saveGroupBy("");
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
          <div key={group.label || "__all__"}>
            {group.label && (
              <div className={styles.groupLabel} data-testid={`env-nav-group-${group.label}`}>
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

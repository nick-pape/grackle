/**
 * PersonaNav -- vertical sidebar navigation for the Persona Library.
 *
 * @module
 */

import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { ArrowUpDown, Circle, Filter, Layers, Plus } from "lucide-react";
import { ICON_XS, ICON_MD } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { PersonaData } from "../../hooks/types.js";
import { personaUrl, NEW_PERSONA_URL, useAppNavigate } from "../../utils/navigation.js";
import { SectionHeader, type SectionHeaderAction } from "../display/SectionHeader.js";
import { FilterDropdown } from "../display/FilterDropdown.js";
import styles from "./PersonaNav.module.scss";

/** Type-indicator color mapping. */
const TYPE_COLORS: Record<string, string> = {
  agent: "var(--accent-green)",
  script: "var(--accent-blue)",
};

/** localStorage keys for persisting filter/group/sort state. */
const STORAGE_KEY_FILTER: string = "grackle-persona-nav-filter";
const STORAGE_KEY_GROUP: string = "grackle-persona-nav-group";
const STORAGE_KEY_SORT: string = "grackle-persona-nav-sort";

/** Read persisted filter state. */
function loadFilter(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FILTER);
    if (raw) {
      return new Set(JSON.parse(raw) as string[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

/** Persist filter state. */
function saveFilterValues(values: Set<string>): void {
  try {
    if (values.size === 0) {
      localStorage.removeItem(STORAGE_KEY_FILTER);
    } else {
      localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify([...values]));
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

/** Read persisted sort. */
function loadSort(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_SORT) ?? "";
  } catch {
    return "";
  }
}

/** Persist sort. */
function saveSort(value: string): void {
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY_SORT, value);
    } else {
      localStorage.removeItem(STORAGE_KEY_SORT);
    }
  } catch {
    /* ignore */
  }
}

/** Props for the PersonaNav component. */
export interface PersonaNavProps {
  /** List of all personas to display in the nav. */
  personas: PersonaData[];
  /** The app-level default persona ID, used to show the "Default" badge. */
  appDefaultPersonaId: string;
}

/** Vertical nav rail listing personas with type indicators, filter, sort, and grouping. */
export function PersonaNav({ personas, appDefaultPersonaId }: PersonaNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const detailMatch = useMatch("/personas/:personaId");
  const rawId = detailMatch?.params.personaId;
  const activeId = rawId === "new" ? undefined : rawId;

  // ── Filter state (by runtime) ───────────────────────────────────
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState(loadFilter);

  // ── Group-by state ──────────────────────────────────────────────
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupBy, setGroupBy] = useState(loadGroupBy);

  // ── Sort state ──────────────────────────────────────────────────
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState(loadSort);

  const filterActive = filterValues.size > 0;
  const groupActive = groupBy !== "";
  const sortActive = sortBy !== "";

  const runtimeOptions = useMemo(() => {
    const unique = [...new Set(personas.map((p) => p.runtime).filter(Boolean))].sort();
    return unique.map((r) => ({ key: r, label: r }));
  }, [personas]);

  const groupOptions = useMemo(() => [{ key: "runtime", label: "By Runtime" }], []);

  const sortOptions = useMemo(
    () => [
      { key: "name-asc", label: "Name A-Z" },
      { key: "name-desc", label: "Name Z-A" },
      { key: "model", label: "Model" },
    ],
    [],
  );

  const handleFilterToggle = useCallback((key: string) => {
    setFilterValues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveFilterValues(next);
      return next;
    });
  }, []);

  const handleFilterClear = useCallback(() => {
    setFilterValues(new Set());
    saveFilterValues(new Set());
  }, []);

  const handleGroupToggle = useCallback((key: string) => {
    setGroupBy((prev) => {
      const next = prev === key ? "" : key;
      saveGroupBy(next);
      setGroupOpen(false);
      return next;
    });
  }, []);

  const handleSortToggle = useCallback((key: string) => {
    setSortBy((prev) => {
      const next = prev === key ? "" : key;
      saveSort(next);
      setSortOpen(false);
      return next;
    });
  }, []);

  // ── Filtered + sorted personas ──────────────────────────────────
  const processed = useMemo(() => {
    let result = personas;
    if (filterActive) {
      result = result.filter((p) => filterValues.has(p.runtime));
    }
    if (sortActive) {
      result = [...result].sort((a, b) => {
        if (sortBy === "name-asc") {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === "name-desc") {
          return b.name.localeCompare(a.name);
        }
        if (sortBy === "model") {
          return (a.model || "").localeCompare(b.model || "");
        }
        return 0;
      });
    }
    return result;
  }, [personas, filterActive, filterValues, sortActive, sortBy]);

  // ── Grouped personas ────────────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupActive) {
      return [{ id: "__all__", label: "", personas: processed }];
    }
    const map = new Map<string, PersonaData[]>();
    for (const p of processed) {
      const key = p.runtime || "(none)";
      const existing = map.get(key);
      if (existing) {
        existing.push(p);
      } else {
        map.set(key, [p]);
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ id: key, label: key, personas: items }));
  }, [processed, groupActive]);

  // ── Header actions ──────────────────────────────────────────────
  const headerActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "filter",
        icon: <Filter size={ICON_MD} />,
        tooltip: filterActive ? "Filter active" : "Filter by runtime",
        ariaLabel: "Filter personas",
        onClick: () => {
          setFilterOpen((p) => !p);
          setGroupOpen(false);
          setSortOpen(false);
        },
        active: filterActive,
        testId: "persona-nav-filter",
      },
      {
        key: "group",
        icon: <Layers size={ICON_MD} />,
        tooltip: groupActive ? "Grouped by runtime" : "Group",
        ariaLabel: "Group personas",
        onClick: () => {
          setGroupOpen((p) => !p);
          setFilterOpen(false);
          setSortOpen(false);
        },
        active: groupActive,
        testId: "persona-nav-group",
      },
      {
        key: "sort",
        icon: <ArrowUpDown size={ICON_MD} />,
        tooltip: sortActive ? `Sorted by ${sortBy}` : "Sort",
        ariaLabel: "Sort personas",
        onClick: () => {
          setSortOpen((p) => !p);
          setFilterOpen(false);
          setGroupOpen(false);
        },
        active: sortActive,
        testId: "persona-nav-sort",
      },
      {
        key: "add",
        icon: <Plus size={ICON_MD} />,
        tooltip: "New persona",
        ariaLabel: "New persona",
        onClick: () => navigate(NEW_PERSONA_URL),
        testId: "persona-nav-add-header",
      },
    ],
    [filterActive, groupActive, sortActive, sortBy, navigate],
  );

  // ── Keyboard nav ────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const flatPersonas = groups.flatMap((g) => g.personas);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : flatPersonas.findIndex((p) => p.id === activeId);
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

      const flatList = groups.flatMap((g) => g.personas);
      if (nextIndex < flatList.length) {
        navigate(personaUrl(flatList[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, groups, navigate],
  );

  const flatPersonas = groups.flatMap((g) => g.personas);
  const activeInList = activeId && flatPersonas.some((p) => p.id === activeId);
  const focusableId =
    (activeInList ? activeId : undefined) ??
    (flatPersonas.length > 0 ? flatPersonas[0].id : undefined);

  const handleClick = useCallback(
    (personaId: string) => {
      navigate(personaUrl(personaId));
    },
    [navigate],
  );

  return (
    <div className={styles.container} data-testid="persona-nav">
      <div className={styles.headerWrapper}>
        <SectionHeader title="Personas" actions={headerActions} data-testid="persona-nav-header" />
        {filterOpen && (
          <FilterDropdown
            options={runtimeOptions}
            selected={filterValues}
            onToggle={handleFilterToggle}
            onClear={handleFilterClear}
            onClose={() => setFilterOpen(false)}
            data-testid="persona-nav-filter-dropdown"
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
            data-testid="persona-nav-group-dropdown"
          />
        )}
        {sortOpen && (
          <FilterDropdown
            options={sortOptions}
            selected={new Set(sortBy ? [sortBy] : [])}
            onToggle={handleSortToggle}
            onClear={() => {
              setSortBy("");
              saveSort("");
              setSortOpen(false);
            }}
            onClose={() => setSortOpen(false)}
            data-testid="persona-nav-sort-dropdown"
          />
        )}
      </div>

      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Personas"
        onKeyDown={handleKeyDown}
        className={styles.nav}
      >
        {groups.map((group) => (
          <div key={group.id}>
            {group.label && <div className={styles.groupLabel}>{group.label}</div>}
            {group.personas.map((persona) => {
              const isActive = persona.id === activeId;
              const isFocusable = persona.id === focusableId;
              const typeColor = TYPE_COLORS[persona.type] || "var(--text-tertiary)";
              const isDefault = persona.id === appDefaultPersonaId;
              return (
                <button
                  key={persona.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  tabIndex={isFocusable ? 0 : -1}
                  className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                  onClick={() => handleClick(persona.id)}
                  data-testid="persona-nav-item"
                >
                  <span className={styles.typeDot} style={{ color: typeColor }} aria-hidden="true">
                    <Circle size={ICON_XS} fill="currentColor" />
                  </span>
                  <span className={styles.tabLabel} title={persona.name}>
                    {persona.name}
                  </span>
                  {persona.runtime && (
                    <span className={styles.runtimeBadge} title={persona.runtime}>
                      {persona.runtime}
                    </span>
                  )}
                  {isDefault && (
                    <span className={styles.defaultBadge} data-testid="persona-nav-default-badge">
                      Default
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <button
        type="button"
        className={styles.addButton}
        onClick={() => navigate(NEW_PERSONA_URL)}
        title="New persona"
        data-testid="persona-nav-add"
      >
        + New Persona
      </button>

      {processed.length === 0 && personas.length > 0 && (
        <div className={styles.empty}>No matching personas.</div>
      )}
      {personas.length === 0 && <div className={styles.empty}>No personas yet.</div>}
    </div>
  );
}

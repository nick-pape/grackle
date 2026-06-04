/**
 * ScheduleNav -- vertical sidebar navigation for the Schedules page.
 *
 * @module
 */

import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Circle, Filter, Layers, Plus } from "lucide-react";
import { ICON_XS, ICON_MD } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { PersonaData, ScheduleData, Workspace } from "../../hooks/types.js";
import { scheduleUrl, NEW_SCHEDULE_URL, useAppNavigate } from "../../utils/navigation.js";
import { formatCountdown } from "../../utils/time.js";
import { SectionHeader, type SectionHeaderAction } from "../display/SectionHeader.js";
import { FilterDropdown } from "../display/FilterDropdown.js";
import styles from "./ScheduleNav.module.scss";

/** localStorage keys for persisting filter/group state. */
const STORAGE_KEY_FILTER: string = "grackle-schedule-nav-filter";
const STORAGE_KEY_GROUP: string = "grackle-schedule-nav-group";

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

/** Props for the ScheduleNav component. */
export interface ScheduleNavProps {
  /** List of all schedules to display in the nav. */
  schedules: ScheduleData[];
  /** All personas -- used to resolve persona names for trailing badges. */
  personas: PersonaData[];
  /** All workspaces -- used to resolve workspace names and for filter options. */
  workspaces: Workspace[];
}

/** Vertical nav rail listing schedules with enabled/disabled status dots. */
export function ScheduleNav({ schedules, personas, workspaces }: ScheduleNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const detailMatch = useMatch("/schedules/:scheduleId");
  const rawId = detailMatch?.params.scheduleId;
  const activeId = rawId === "new" ? undefined : rawId;

  const personaMap = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const workspaceMap = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

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
    if (filterField === "persona") {
      const unique = [...new Set(schedules.map((s) => s.personaId).filter(Boolean))];
      return unique.map((pid) => ({
        key: pid,
        label: personaMap.get(pid)?.name ?? pid,
      }));
    }
    if (filterField === "workspace") {
      const unique = [...new Set(schedules.map((s) => s.workspaceId).filter(Boolean))];
      return unique.map((wid) => ({
        key: wid,
        label: workspaceMap.get(wid)?.name ?? wid,
      }));
    }
    return [
      { key: "persona", label: "By Persona" },
      { key: "workspace", label: "By Workspace" },
    ];
  }, [filterField, schedules, personaMap, workspaceMap]);

  const groupOptions = useMemo(
    () => [
      { key: "persona", label: "By Persona" },
      { key: "workspace", label: "By Workspace" },
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

  // ── Filtered schedules ──────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!filterActive) {
      return schedules;
    }
    return schedules.filter((s) => {
      if (filterField === "persona") {
        return filterValues.has(s.personaId);
      }
      if (filterField === "workspace") {
        return filterValues.has(s.workspaceId);
      }
      return true;
    });
  }, [schedules, filterActive, filterField, filterValues]);

  // ── Grouped schedules ───────────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupActive) {
      return [{ id: "__all__", label: "", schedules: filtered }];
    }
    const map = new Map<string, ScheduleData[]>();
    for (const s of filtered) {
      const key = groupBy === "persona" ? s.personaId || "(none)" : s.workspaceId || "(none)";
      const existing = map.get(key);
      if (existing) {
        existing.push(s);
      } else {
        map.set(key, [s]);
      }
    }
    const nameResolver =
      groupBy === "persona"
        ? (k: string) => personaMap.get(k)?.name ?? k
        : (k: string) => workspaceMap.get(k)?.name ?? k;
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        id: key,
        label: key === "(none)" ? "(none)" : nameResolver(key),
        schedules: items,
      }));
  }, [filtered, groupActive, groupBy, personaMap, workspaceMap]);

  // ── Header actions ──────────────────────────────────────────────
  const headerActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "filter",
        icon: <Filter size={ICON_MD} />,
        tooltip: filterActive ? "Filter active" : "Filter",
        ariaLabel: "Filter schedules",
        onClick: () => {
          setFilterOpen((p) => !p);
          setGroupOpen(false);
        },
        active: filterActive,
        testId: "schedule-nav-filter",
      },
      {
        key: "group",
        icon: <Layers size={ICON_MD} />,
        tooltip: groupActive ? `Grouped by ${groupBy}` : "Group",
        ariaLabel: "Group schedules",
        onClick: () => {
          setGroupOpen((p) => !p);
          setFilterOpen(false);
        },
        active: groupActive,
        testId: "schedule-nav-group",
      },
      {
        key: "add",
        icon: <Plus size={ICON_MD} />,
        tooltip: "New schedule",
        ariaLabel: "New schedule",
        onClick: () => navigate(NEW_SCHEDULE_URL),
        testId: "schedule-nav-add-header",
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
      const flatSchedules = groups.flatMap((g) => g.schedules);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : flatSchedules.findIndex((s) => s.id === activeId);
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

      const flatList = groups.flatMap((g) => g.schedules);
      if (nextIndex < flatList.length) {
        navigate(scheduleUrl(flatList[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, groups, navigate],
  );

  const flatSchedules = groups.flatMap((g) => g.schedules);
  const activeInList = activeId && flatSchedules.some((s) => s.id === activeId);
  const focusableId =
    (activeInList ? activeId : undefined) ??
    (flatSchedules.length > 0 ? flatSchedules[0].id : undefined);

  const handleClick = useCallback(
    (scheduleId: string) => {
      navigate(scheduleUrl(scheduleId));
    },
    [navigate],
  );

  return (
    <div className={styles.container} data-testid="schedule-nav">
      <div className={styles.headerWrapper}>
        <SectionHeader
          title="Schedules"
          actions={headerActions}
          data-testid="schedule-nav-header"
        />
        {filterOpen && (
          <FilterDropdown
            options={filterOptions}
            selected={filterField ? filterValues : new Set<string>()}
            onToggle={handleFilterToggle}
            onClear={handleFilterClear}
            onClose={() => setFilterOpen(false)}
            showClear={!!filterField}
            data-testid="schedule-nav-filter-dropdown"
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
            data-testid="schedule-nav-group-dropdown"
          />
        )}
      </div>

      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Schedules"
        onKeyDown={handleKeyDown}
        className={styles.nav}
      >
        {groups.map((group) => (
          <div key={group.id}>
            {group.label && <div className={styles.groupLabel}>{group.label}</div>}
            {group.schedules.map((schedule) => {
              const isActive = schedule.id === activeId;
              const isFocusable = schedule.id === focusableId;
              const statusColor = schedule.enabled ? "var(--accent-green)" : "var(--text-tertiary)";
              const persona = personaMap.get(schedule.personaId);
              const trailingText =
                schedule.enabled && schedule.nextRunAt
                  ? formatCountdown(schedule.nextRunAt)
                  : persona?.name;
              return (
                <button
                  key={schedule.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  tabIndex={isFocusable ? 0 : -1}
                  className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                  onClick={() => handleClick(schedule.id)}
                  data-testid="schedule-nav-item"
                >
                  <span
                    className={styles.statusDot}
                    style={{ color: statusColor }}
                    aria-hidden="true"
                  >
                    <Circle size={ICON_XS} fill="currentColor" />
                  </span>
                  <span className={styles.tabLabel} title={schedule.title}>
                    {schedule.title}
                  </span>
                  {trailingText && (
                    <span className={styles.trailingBadge} title={trailingText}>
                      {trailingText}
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
        onClick={() => navigate(NEW_SCHEDULE_URL)}
        title="New schedule"
        data-testid="schedule-nav-add"
      >
        + New Schedule
      </button>

      {filtered.length === 0 && schedules.length > 0 && (
        <div className={styles.empty}>No matching schedules.</div>
      )}
      {schedules.length === 0 && <div className={styles.empty}>No schedules yet.</div>}
    </div>
  );
}

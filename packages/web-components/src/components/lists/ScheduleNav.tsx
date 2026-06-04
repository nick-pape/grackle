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
import { FilterDropdown, type FilterDropdownGroup } from "../display/FilterDropdown.js";
import { useFilterGroupSort } from "../../hooks/useFilterGroupSort.js";
import styles from "./ScheduleNav.module.scss";

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

  const {
    filterValues,
    filterActive,
    toggleFilter,
    clearFilter,
    groupBy,
    groupActive,
    toggleGroup,
    clearGroup,
  } = useFilterGroupSort({ storagePrefix: "grackle-schedule-nav" });

  const [filterOpen, setFilterOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  // ── Filter groups (single-level, all dimensions at once) ────────
  const filterGroups = useMemo<FilterDropdownGroup[]>(() => {
    const personaIds = [...new Set(schedules.map((s) => s.personaId).filter(Boolean))];
    const workspaceIds = [...new Set(schedules.map((s) => s.workspaceId).filter(Boolean))];
    return [
      {
        label: "Persona",
        options: personaIds.map((pid) => ({
          key: `persona:${pid}`,
          label: personaMap.get(pid)?.name ?? pid,
        })),
      },
      {
        label: "Workspace",
        options: workspaceIds.map((wid) => ({
          key: `workspace:${wid}`,
          label: workspaceMap.get(wid)?.name ?? wid,
        })),
      },
    ];
  }, [schedules, personaMap, workspaceMap]);

  const groupOptions = useMemo(
    () => [
      { key: "persona", label: "By Persona" },
      { key: "workspace", label: "By Workspace" },
    ],
    [],
  );

  // ── Filtered schedules ──────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!filterActive) {
      return schedules;
    }
    const personaFilters = new Set<string>();
    const workspaceFilters = new Set<string>();
    for (const k of filterValues) {
      if (k.startsWith("persona:")) {
        personaFilters.add(k);
      } else if (k.startsWith("workspace:")) {
        workspaceFilters.add(k);
      }
    }
    return schedules.filter((s) => {
      const passesPersona =
        personaFilters.size === 0 || (s.personaId && personaFilters.has(`persona:${s.personaId}`));
      const passesWorkspace =
        workspaceFilters.size === 0 ||
        (s.workspaceId && workspaceFilters.has(`workspace:${s.workspaceId}`));
      return passesPersona && passesWorkspace;
    });
  }, [schedules, filterActive, filterValues]);

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
            groups={filterGroups}
            selected={filterValues}
            onToggle={toggleFilter}
            onClear={clearFilter}
            onClose={() => setFilterOpen(false)}
            data-testid="schedule-nav-filter-dropdown"
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

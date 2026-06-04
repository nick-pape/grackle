/**
 * FilterDropdown -- small absolutely-positioned multi-select menu for sidebar
 * filter/group/sort controls.
 *
 * Supports both flat option lists and grouped sections (e.g., filter by Status
 * AND Type in a single dropdown with labeled sections).
 *
 * @module
 */

import { useEffect, useRef, type JSX } from "react";
import { X } from "lucide-react";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./FilterDropdown.module.scss";

/** A single selectable option in the filter menu. */
export interface FilterDropdownOption {
  /** Unique key identifying this option. */
  key: string;
  /** Human-readable label. */
  label: string;
}

/** A labeled group of options rendered with a section header. */
export interface FilterDropdownGroup {
  /** Section header label. */
  label: string;
  /** Options within this group. */
  options: FilterDropdownOption[];
}

/** Props for the {@link FilterDropdown} component. */
export interface FilterDropdownProps {
  /** Flat list of options (use this OR `groups`, not both). */
  options?: FilterDropdownOption[];
  /** Grouped sections with labeled headers. Takes precedence over `options`. */
  groups?: FilterDropdownGroup[];
  /** Currently selected option keys. */
  selected: ReadonlySet<string>;
  /** Toggle an option on/off. */
  onToggle: (key: string) => void;
  /** Clear all selections. */
  onClear: () => void;
  /** Close the dropdown. */
  onClose: () => void;
  /** Force the Clear button to show even when no options are selected. */
  showClear?: boolean;
  /** Optional data-testid for the menu root. */
  "data-testid"?: string;
}

/** Render a single option button. */
function OptionButton({
  opt,
  isSelected,
  onToggle,
  testId,
}: {
  opt: FilterDropdownOption;
  isSelected: boolean;
  onToggle: (key: string) => void;
  testId: string;
}): JSX.Element {
  return (
    <button
      key={opt.key}
      type="button"
      className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
      onClick={() => onToggle(opt.key)}
      aria-pressed={isSelected}
      data-testid={`${testId}-option-${opt.key}`}
    >
      <span className={styles.check} aria-hidden="true">
        {isSelected ? "✓" : ""}
      </span>
      <span className={styles.optionLabel}>{opt.label}</span>
    </button>
  );
}

/** Absolutely-positioned multi-select filter menu. */
export function FilterDropdown({
  options,
  groups,
  selected,
  onToggle,
  onClear,
  onClose,
  showClear: showClearProp = false,
  "data-testid": testId = "filter-dropdown",
}: FilterDropdownProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    const id = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClickOutside);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const resolvedGroups: FilterDropdownGroup[] = groups
    ? groups
    : options
      ? [{ label: "", options }]
      : [];

  return (
    <div ref={containerRef} className={styles.dropdown} data-testid={testId}>
      {(selected.size > 0 || showClearProp) && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={onClear}
          data-testid={`${testId}-clear`}
        >
          <X size={ICON_SM} aria-hidden="true" />
          Clear
        </button>
      )}
      {resolvedGroups.map((group) => (
        <div key={group.label || "__flat__"}>
          {group.label && <div className={styles.groupLabel}>{group.label}</div>}
          {group.options.map((opt) => (
            <OptionButton
              key={opt.key}
              opt={opt}
              isSelected={selected.has(opt.key)}
              onToggle={onToggle}
              testId={testId}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

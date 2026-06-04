/**
 * FilterDropdown -- small absolutely-positioned multi-select menu for sidebar
 * filter/group/sort controls.
 *
 * Reuses the click-outside + Escape-close pattern from {@link SplitButton}.
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

/** Props for the {@link FilterDropdown} component. */
export interface FilterDropdownProps {
  /** Menu options. */
  options: FilterDropdownOption[];
  /** Currently selected option keys. */
  selected: ReadonlySet<string>;
  /** Toggle an option on/off. */
  onToggle: (key: string) => void;
  /** Clear all selections. */
  onClear: () => void;
  /** Close the dropdown. */
  onClose: () => void;
  /** Optional data-testid for the menu root. */
  "data-testid"?: string;
}

/** Absolutely-positioned multi-select filter menu. */
export function FilterDropdown({
  options,
  selected,
  onToggle,
  onClear,
  onClose,
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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

  return (
    <div ref={containerRef} className={styles.dropdown} data-testid={testId}>
      {selected.size > 0 && (
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
      {options.map((opt) => {
        const isSelected = selected.has(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
            onClick={() => onToggle(opt.key)}
            data-testid={`${testId}-option-${opt.key}`}
          >
            <span className={styles.check} aria-hidden="true">
              {isSelected ? "✓" : ""}
            </span>
            <span className={styles.optionLabel}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

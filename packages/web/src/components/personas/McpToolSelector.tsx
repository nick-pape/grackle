/**
 * A categorized multiselect for choosing which MCP tools a persona can access.
 *
 * Pure presentational component — receives data and callbacks as props.
 */

import { useState, useMemo, useCallback, type JSX } from "react";
import {
  ALL_MCP_TOOL_NAMES,
  DEFAULT_SCOPED_MCP_TOOLS,
  WORKER_MCP_TOOLS,
  ORCHESTRATOR_MCP_TOOLS,
  ADMIN_MCP_TOOLS,
} from "@grackle-ai/common";
import styles from "./McpToolSelector.module.scss";

/** Tool groups derived from the naming convention (prefix before first underscore). */
const TOOL_GROUPS: { group: string; tools: string[] }[] = (() => {
  const grouped = new Map<string, string[]>();
  for (const name of ALL_MCP_TOOL_NAMES) {
    // Most tools use "group_action" naming; "get_version_status" is a special case
    const group = name === "get_version_status" ? "version" : name.split("_")[0];
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(name);
  }
  // Sort groups alphabetically, tools within each group alphabetically
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, tools]) => ({ group, tools: tools.sort() }));
})();

/** Preset definitions for quick selection. */
const PRESETS = [
  { name: "default", label: "Default", tools: DEFAULT_SCOPED_MCP_TOOLS },
  { name: "worker", label: "Worker", tools: WORKER_MCP_TOOLS },
  { name: "orchestrator", label: "Orchestrator", tools: ORCHESTRATOR_MCP_TOOLS },
  { name: "admin", label: "Admin", tools: ADMIN_MCP_TOOLS },
] as const;

export interface McpToolSelectorProps {
  /** Currently selected tool names. Empty = default (shown as hint, not checked). */
  selectedTools: string[];
  /** Callback when selection changes. */
  onChange: (tools: string[]) => void;
  /** Whether the component is disabled. */
  disabled?: boolean;
}

export function McpToolSelector({ selectedTools, onChange, disabled }: McpToolSelectorProps): JSX.Element {
  const [filter, setFilter] = useState("");
  const selectedSet = useMemo(() => new Set(selectedTools), [selectedTools]);

  const toggleTool = useCallback((tool: string) => {
    if (disabled) {
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(tool)) {
      next.delete(tool);
    } else {
      next.add(tool);
    }
    onChange([...next].sort());
  }, [selectedSet, onChange, disabled]);

  const toggleGroup = useCallback((tools: string[], allSelected: boolean) => {
    if (disabled) {
      return;
    }
    const next = new Set(selectedSet);
    for (const t of tools) {
      if (allSelected) {
        next.delete(t);
      } else {
        next.add(t);
      }
    }
    onChange([...next].sort());
  }, [selectedSet, onChange, disabled]);

  const applyPreset = useCallback((tools: readonly string[]) => {
    if (disabled) {
      return;
    }
    onChange([...tools].sort());
  }, [onChange, disabled]);

  const lowerFilter = filter.toLowerCase();

  return (
    <div className={styles.container} data-testid="mcp-tool-selector">
      <div className={styles.header}>
        <span className={styles.count}>
          {selectedTools.length === 0
            ? `Using default (${DEFAULT_SCOPED_MCP_TOOLS.length} tools)`
            : `${selectedTools.length} of ${ALL_MCP_TOOL_NAMES.size} tools selected`}
        </span>
      </div>

      <div className={styles.presets} data-testid="mcp-tool-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={styles.presetButton}
            disabled={disabled}
            onClick={() => applyPreset(preset.tools)}
            data-testid={`preset-${preset.name}`}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.presetButton}
          disabled={disabled}
          onClick={() => onChange([])}
          data-testid="preset-clear"
        >
          Clear
        </button>
      </div>

      <input
        type="text"
        className={styles.filterInput}
        placeholder="Filter tools..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={disabled}
        data-testid="mcp-tool-filter"
      />

      <div className={styles.groups}>
        {TOOL_GROUPS.map(({ group, tools }) => {
          const visibleTools = lowerFilter
            ? tools.filter((t) => t.toLowerCase().includes(lowerFilter))
            : tools;
          if (visibleTools.length === 0) {
            return null;
          }
          const allSelected = visibleTools.every((t) => selectedSet.has(t));
          return (
            <div key={group} className={styles.group} data-testid={`tool-group-${group}`}>
              <label className={styles.groupHeader}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => toggleGroup(visibleTools, allSelected)}
                  disabled={disabled}
                  data-testid={`group-toggle-${group}`}
                />
                <span className={styles.groupName}>{group}</span>
                <span className={styles.groupCount}>
                  ({visibleTools.filter((t) => selectedSet.has(t)).length}/{visibleTools.length})
                </span>
              </label>
              <div className={styles.toolList}>
                {visibleTools.map((tool) => (
                  <label key={tool} className={styles.toolItem}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(tool)}
                      onChange={() => toggleTool(tool)}
                      disabled={disabled}
                      data-testid={`tool-${tool}`}
                    />
                    <span className={styles.toolName}>{tool}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

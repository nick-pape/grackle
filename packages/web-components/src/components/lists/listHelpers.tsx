/**
 * Shared helpers for sidebar list components (WorkspaceList, TaskList).
 *
 * @module
 */

import type { JSX } from "react";
import type { TaskData } from "../../hooks/types.js";
import type { MatchIndex } from "@grackle-ai/common";
import { SIDEBAR_STATUS_ORDER, getStatusStyle } from "../../utils/taskStatus.js";

// ---------------------------------------------------------------------------
// Highlight helpers
// ---------------------------------------------------------------------------

/** Merge overlapping or adjacent [start, end] ranges into non-overlapping ranges. */
export function mergeRanges(ranges: readonly MatchIndex[]): MatchIndex[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const [start, end] = sorted[i];
    if (start <= prev[1] + 1) {
      prev[1] = Math.max(prev[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Render text with highlighted match ranges. Unmatched portions are plain, matched portions are bold. */
export function HighlightedText({ text, indices, highlightClass }: { text: string; indices?: readonly MatchIndex[]; highlightClass?: string }): JSX.Element {
  if (!indices || indices.length === 0) {
    return <>{text}</>;
  }
  const merged = mergeRanges(indices);
  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push(<span key={`p${cursor}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(<mark key={`m${start}`} className={highlightClass}>{text.slice(start, end + 1)}</mark>);
    cursor = end + 1;
  }
  if (cursor < text.length) {
    parts.push(<span key={`p${cursor}`}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Task tree
// ---------------------------------------------------------------------------

/** A task node with children for recursive tree rendering. */
export interface TaskNode extends TaskData {
  children: TaskNode[];
}

/** Assemble flat TaskData[] into a tree. */
export function buildTaskTree(taskList: TaskData[]): TaskNode[] {
  const byId = new Map<string, TaskNode>(
    taskList.map(t => [t.id, { ...t, children: [] }]),
  );
  const roots: TaskNode[] = [];
  for (const node of byId.values()) {
    if (node.parentTaskId && byId.has(node.parentTaskId)) {
      byId.get(node.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return roots.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// Status grouping
// ---------------------------------------------------------------------------

/** A group of tasks sharing the same status. */
export interface StatusGroup {
  status: string;
  label: string;
  style: { color: string; icon: string };
  tasks: TaskData[];
}

/** Group a flat list of tasks by status, ordered by urgency. Blocked tasks are separated into their own group. */
export function groupTasksByStatus(taskList: TaskData[], taskStatusById: Map<string, string>): StatusGroup[] {
  const byStatus = new Map<string, TaskData[]>();
  for (const task of taskList) {
    const isBlocked = task.dependsOn.length > 0 &&
      task.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");
    const groupKey = isBlocked ? "blocked" : task.status;
    const list = byStatus.get(groupKey);
    if (list) {
      list.push(task);
    } else {
      byStatus.set(groupKey, [task]);
    }
  }

  const groups: StatusGroup[] = [];
  const seen = new Set<string>();
  for (const status of SIDEBAR_STATUS_ORDER) {
    seen.add(status);
    const tasks = byStatus.get(status);
    if (tasks && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      const style = getStatusStyle(status);
      groups.push({ status, label: style.label, style, tasks });
    }
  }
  for (const [status, tasks] of byStatus) {
    if (!seen.has(status) && tasks.length > 0) {
      tasks.sort((a, b) => a.sortOrder - b.sortOrder);
      const style = getStatusStyle(status);
      groups.push({ status, label: style.label, style, tasks });
    }
  }
  return groups;
}

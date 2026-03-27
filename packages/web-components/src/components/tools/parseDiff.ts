/**
 * Lightweight diff parsing utilities for the FileEditCard.
 *
 * Handles two formats:
 * 1. Unified diff strings (from Copilot's `detailedContent` field)
 * 2. Old/new string pairs (from Claude Code's `Edit` tool args)
 */

/** A single line in a parsed diff. */
export interface DiffLine {
  /** Line classification. */
  type: "add" | "remove" | "context" | "header";
  /** Line content (without the leading +/- prefix). */
  content: string;
}

/** Addition/removal counts for a diff. */
export interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Parses a unified diff string into typed lines.
 *
 * Recognizes `@@` hunk headers, `+`/`-` prefixed lines, and context lines.
 * Skips `---`/`+++` file header lines and `diff --git` preamble.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ")) {
      continue;
    }
    // Skip file header lines (--- a/file, +++ b/file) but not hunk content
    // lines that happen to start with "---" or "+++" (which appear as
    // "----..." or "++++..." in the diff and are handled by +/- rules below).
    if ((line.startsWith("--- ") || line.startsWith("+++ ")) && !line.startsWith("---- ") && !line.startsWith("++++ ")) {
      continue;
    }
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", content: line.slice(1) });
    } else if (line === "") {
      // Empty lines in unified diffs are context lines
      result.push({ type: "context", content: "" });
    }
  }

  return result;
}

/**
 * Constructs a minimal diff from old and new strings.
 *
 * This is a simple line-by-line comparison — not a true LCS diff algorithm.
 * Shows all old lines as removals followed by all new lines as additions.
 * Good enough for the small, targeted edits agents typically make.
 */
export function diffFromOldNew(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const result: DiffLine[] = [];

  for (const line of oldLines) {
    result.push({ type: "remove", content: line });
  }
  for (const line of newLines) {
    result.push({ type: "add", content: line });
  }

  return result;
}

/** Counts additions and removals in a parsed diff. */
export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") {
      added++;
    }
    if (line.type === "remove") {
      removed++;
    }
  }
  return { added, removed };
}

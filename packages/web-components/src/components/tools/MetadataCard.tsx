import type { JSX } from "react";
import { CornerDownRight } from "lucide-react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./toolCards.module.scss";

/** Extracts a human-readable summary from metadata tool args. */
function getSummary(tool: string, args: unknown): string {
  if (args === null || args === undefined || typeof args !== "object") {
    return "";
  }
  const a = args as Record<string, unknown>;

  // report_intent: show the intent value
  if (typeof a.intent === "string") {
    return a.intent;
  }

  // Generic: show first string value
  for (const value of Object.values(a)) {
    if (typeof value === "string") {
      return value;
    }
  }

  return tool;
}

/** Renders a metadata/intent tool call as a minimal inline annotation. */
export function MetadataCard({ tool, args }: ToolCardProps): JSX.Element {
  const summary = getSummary(tool, args);

  return (
    <div className={styles.metadata} data-testid="tool-card-metadata">
      <span className={styles.metadataPrefix}><CornerDownRight size={ICON_SM} /></span>
      {summary}
    </div>
  );
}

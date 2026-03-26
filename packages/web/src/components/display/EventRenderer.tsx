import { useState, type JSX } from "react";
import Markdown from "react-markdown";
import rehypePrismPlus from "rehype-prism-plus/common";
import remarkGfm from "remark-gfm";
import type { SessionEvent } from "../../hooks/useGrackleSocket.js";
import { formatTokens, formatCost } from "../../utils/format.js";
import { ToolCard } from "../tools/ToolCard.js";
import styles from "./EventRenderer.module.scss";

/** Props for the EventRenderer component. */
interface Props {
  event: SessionEvent;
  /** Paired tool_use context, attached by SessionPanel when raw IDs match. */
  toolUseCtx?: { tool: string; args: unknown; detailedResult?: string };
}

// --- Individual event type renderers ---

/** Number of lines shown in the collapsed system context preview. */
const SYSTEM_CONTEXT_PREVIEW_LINES: number = 3;

/** Renders the system context (system prompt) as a collapsible left-bordered section. */
function SystemContextEvent({ content }: { content: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const hasMore = lines.length > SYSTEM_CONTEXT_PREVIEW_LINES;
  const displayContent = expanded ? content : lines.slice(0, SYSTEM_CONTEXT_PREVIEW_LINES).join("\n");

  return (
    <div className={styles.systemContextEvent} data-testid="system-context-event">
      <button
        type="button"
        className={styles.systemContextHeader}
        onClick={() => { setExpanded((v) => !v); }}
        aria-expanded={expanded}
      >
        <span className={styles.systemContextBadge}>SYSTEM PROMPT</span>
        {hasMore && (
          <span className={styles.systemContextToggle} aria-hidden="true">
            {expanded ? "\u25be" : "\u25b8"}
          </span>
        )}
      </button>
      <pre className={styles.systemContextPre}>
        {displayContent}
        {!expanded && hasMore && (
          <span className={styles.systemContextEllipsis}>{"\u2026"}</span>
        )}
      </pre>
    </div>
  );
}

/** Renders a system-level event with timestamp. */
function SystemEvent({ time, content }: { time: string; content: string }): JSX.Element {
  return (
    <div className={styles.systemEvent}>
      <span className={styles.systemTimestamp}>[{time}]</span> {content}
    </div>
  );
}

/** Renders an assistant text output event with markdown formatting. */
function TextEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.textEvent}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePrismPlus]}>
        {content}
      </Markdown>
    </div>
  );
}

// ToolUseEvent and ToolResultEvent have been replaced by the ToolCard component
// in packages/web/src/components/tools/. See ToolCard.tsx for the router and
// individual card components (FileReadCard, FileEditCard, ShellCard, etc.).

/** Renders an error event with red styling. */
function ErrorEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.errorEvent}>
      Error: {content}
    </div>
  );
}

/** Renders a status change event with separator lines. */
function StatusEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.statusEvent}>
      --- {content} ---
    </div>
  );
}

/** Renders a user input event, right-aligned to distinguish it from agent output. */
function UserInputEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.userInputEvent}>
      <span className={styles.userInputContent}>{content}</span>
    </div>
  );
}

/** Renders a signal event (e.g. SIGCHLD) as a left-bordered banner. */
function SignalEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.signalEvent} data-testid="signal-event">
      <span className={styles.signalBadge}>SIGNAL</span>
      <span className={styles.signalContent}>{content}</span>
    </div>
  );
}

/** Renders a usage event as a compact cost badge. */
function UsageEvent({ content }: { content: string }): JSX.Element {
  let label = content;
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const inTok = Number(data.input_tokens) || 0;
    const outTok = Number(data.output_tokens) || 0;
    const tokens = formatTokens(inTok + outTok);
    const cost = formatCost(Number(data.cost_usd) || 0);
    label = `${tokens} tokens \u00b7 ${cost}`;
  } catch { /* show raw content if JSON fails */ }
  return (
    <div className={styles.usageEvent} data-testid="usage-event">
      <span className={styles.usageBadge}>{label}</span>
    </div>
  );
}

/** Renders an unrecognized event type. */
function DefaultEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.defaultEvent}>{content}</div>
  );
}

// --- Main component ---

/** Renders a single session event, dispatching to the appropriate type-specific renderer. */
export function EventRenderer({ event, toolUseCtx }: Props): JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString();

  switch (event.eventType) {
    case "system": {
      // Detect system context events via the raw metadata marker
      if (event.raw) {
        try {
          const rawData = JSON.parse(event.raw) as Record<string, unknown>;
          if (rawData.systemContext === true) {
            return <SystemContextEvent content={event.content} />;
          }
        } catch { /* not JSON, render as normal system event */ }
      }
      return <SystemEvent time={time} content={event.content} />;
    }
    case "text":
    case "output":
      return <TextEvent content={event.content} />;
    case "tool_use": {
      let tool = "";
      let args: unknown = {};
      try {
        const parsed = JSON.parse(event.content) as { tool?: string; args?: unknown };
        tool = parsed.tool || "";
        args = parsed.args;
      } catch { /* fallback to empty */ }
      return <ToolCard tool={tool} args={args} />;
    }
    case "tool_result": {
      // When paired, toolUseCtx provides the tool name, args, and optional detailedResult.
      // When unpaired, fall back to a generic display.
      let isError = false;
      if (event.raw) {
        try {
          const rawData = JSON.parse(event.raw) as Record<string, unknown>;
          isError = rawData.is_error === true;
        } catch { /* ignore */ }
      }

      // Try to extract displayable content from JSON-wrapped results.
      // Guard with startsWith check to avoid throwing on plain text content.
      let resultContent = event.content;
      if (event.content.trimStart().startsWith("{")) {
        try {
          const parsed = JSON.parse(event.content) as Record<string, unknown>;
          if (typeof parsed.content === "string") {
            resultContent = parsed.content;
          }
        } catch { /* content looks like JSON but isn't — use as-is */ }
      }

      if (toolUseCtx) {
        return (
          <ToolCard
            tool={toolUseCtx.tool}
            args={toolUseCtx.args}
            result={resultContent}
            isError={isError}
            detailedResult={toolUseCtx.detailedResult}
          />
        );
      }
      // Unpaired tool_result — use generic card with fallback label
      return <ToolCard tool="Tool output" args={{}} result={resultContent} isError={isError} />;
    }
    case "error":
      return <ErrorEvent content={event.content} />;
    case "status":
      return <StatusEvent content={event.content} />;
    case "user_input":
      return <UserInputEvent content={event.content} />;
    case "signal":
      return <SignalEvent content={event.content} />;
    case "usage":
      return <UsageEvent content={event.content} />;
    default:
      return <DefaultEvent content={event.content} />;
  }
}

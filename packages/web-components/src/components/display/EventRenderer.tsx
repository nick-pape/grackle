import {
  type ReactNode,
  useState,
  lazy,
  Suspense,
  type LazyExoticComponent,
  type ComponentType,
  type JSX,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import rehypePrismPlus from "rehype-prism-plus/common";
import remarkGfm from "remark-gfm";
import type { SessionEvent } from "../../hooks/types.js";
import { detectDelegation, delegationIdentityKey, deriveChildSessionId } from "@grackle-ai/common";
import { formatTokens, formatCost } from "../../utils/format.js";
import { ICON_SM } from "../../utils/iconSize.js";
import { ToolCard } from "../tools/ToolCard.js";
import type { McpAppWidgetProps } from "./McpAppWidget.js";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CopyButton } from "./CopyButton.js";
import styles from "./EventRenderer.module.scss";

// Lazy-loaded (and intentionally NOT re-exported from the package barrel) so the
// heavy ext-apps AppBridge is code-split into an async chunk loaded only when a
// widget actually renders — keeps the main chat bundle under the chunk-size cap.
const McpAppWidget: LazyExoticComponent<ComponentType<McpAppWidgetProps>> = lazy(() =>
  import("./McpAppWidget.js").then((m) => ({ default: m.McpAppWidget })),
);

/** Props for the EventRenderer component. */
interface Props {
  event: SessionEvent;
  /** Paired tool_use context, attached by SessionPanel when raw IDs match. */
  toolUseCtx?: { tool: string; args: unknown; detailedResult?: string };
  /** True when a tool_use completed but has no tool_result (e.g. Claude Code text-result pattern). */
  settled?: boolean;
  /** Sandbox proxy origin URL for rendering MCP Apps widget events (different origin than the app). */
  sandboxProxyUrl?: string;
  /** Open a file in the live-docs pane (#1396) — makes `file://` links and tool file paths clickable. */
  onOpenDocument?: (uri: string) => void;
}

/**
 * Compute the materialized child session id for a delegation tool call, using
 * the same shared derivation the server uses to create the child (#1075), so the
 * agent card can link to the subagent's activity view. Returns undefined for
 * non-delegation tools or when the parent session / tool-call id is unknown.
 */
function delegationChildId(
  parentSessionId: string,
  toolCallId: string | undefined,
  tool: string,
  args: unknown,
): string | undefined {
  if (!parentSessionId || !toolCallId) {
    return undefined;
  }
  const info = detectDelegation(tool, args);
  if (!info) {
    return undefined;
  }
  return deriveChildSessionId(parentSessionId, delegationIdentityKey(info, toolCallId));
}

// --- Individual event type renderers ---

/** Number of lines shown in the collapsed system context preview. */
const SYSTEM_CONTEXT_PREVIEW_LINES: number = 3;

/** Renders the system context (system prompt) as a collapsible left-bordered section. */
function SystemContextEvent({ content }: { content: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const hasMore = lines.length > SYSTEM_CONTEXT_PREVIEW_LINES;
  const displayContent = expanded
    ? content
    : lines.slice(0, SYSTEM_CONTEXT_PREVIEW_LINES).join("\n");

  return (
    <div className={styles.systemContextEvent} data-testid="system-context-event">
      <button
        type="button"
        className={styles.systemContextHeader}
        onClick={() => {
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
      >
        <span className={styles.systemContextBadge}>SYSTEM PROMPT</span>
        {hasMore && (
          <span className={styles.systemContextToggle} aria-hidden="true">
            {expanded ? <ChevronDown size={ICON_SM} /> : <ChevronRight size={ICON_SM} />}
          </span>
        )}
      </button>
      <pre className={styles.systemContextPre}>
        {displayContent}
        {!expanded && hasMore && <span className={styles.systemContextEllipsis}>{"\u2026"}</span>}
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

/** Recursively extracts plain text from React children (for code block copy). */
export function extractText(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (node !== null && node !== undefined && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** Props passed by react-markdown to component overrides. */
interface PreProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: ReactNode;
  /** AST node injected by react-markdown — must not be spread onto the DOM element. */
  node?: unknown;
}

/** Wraps markdown `<pre>` blocks with a CopyButton for code-only copy. */
function CodeBlockWrapper({ children, node, ...preProps }: PreProps): JSX.Element {
  // node is destructured solely to exclude it from the DOM spread
  if (node === undefined) {
    /* intentionally unused */
  }
  const rawText = extractText(children);
  return (
    <div className={styles.codeBlockWrapper}>
      <pre {...preProps}>{children}</pre>
      <CopyButton
        text={rawText}
        data-testid="copy-code-block"
        className={styles.codeBlockCopyButton}
      />
    </div>
  );
}

/**
 * Renders a markdown string with GFM support and syntax-highlighted code blocks.
 *
 * Shared by both assistant text events and user input events so the two render
 * through an identical pipeline. When `onOpenDocument` is provided, `file://`
 * links open in the live-docs pane instead of navigating (#1396).
 */
function MarkdownContent({
  content,
  onOpenDocument,
}: {
  content: string;
  onOpenDocument?: (uri: string) => void;
}): JSX.Element {
  const components: Components = {
    pre: CodeBlockWrapper,
    a(props: JSX.IntrinsicElements["a"] & ExtraProps) {
      const { href, children } = props;
      if (href && href.startsWith("file://") && onOpenDocument) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpenDocument(href);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePrismPlus]} components={components}>
      {content}
    </Markdown>
  );
}

/** Renders an assistant text output event with markdown formatting. */
function TextEvent({
  content,
  onOpenDocument,
}: {
  content: string;
  onOpenDocument?: (uri: string) => void;
}): JSX.Element {
  return (
    <div className={styles.textEvent}>
      <MarkdownContent content={content} onOpenDocument={onOpenDocument} />
    </div>
  );
}

// ToolUseEvent and ToolResultEvent have been replaced by the ToolCard component
// in packages/web/src/components/tools/. See ToolCard.tsx for the router and
// individual card components (FileReadCard, FileEditCard, ShellCard, etc.).

/** Renders an error event with red styling. */
function ErrorEvent({ content }: { content: string }): JSX.Element {
  return <div className={styles.errorEvent}>Error: {content}</div>;
}

/** Renders a status change event with separator lines. */
function StatusEvent({ content }: { content: string }): JSX.Element {
  return <div className={styles.statusEvent}>--- {content} ---</div>;
}

/** Renders a user input event as markdown, right-aligned to distinguish it from agent output. */
function UserInputEvent({ content }: { content: string }): JSX.Element {
  return (
    <div className={styles.userInputEvent}>
      <div className={styles.userInputContent} data-testid="user-input-content">
        <MarkdownContent content={content} />
      </div>
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
    const cost = formatCost(Number(data.cost_millicents) || 0);
    label = `${tokens} tokens \u00b7 ${cost}`;
  } catch {
    /* show raw content if JSON fails */
  }
  return (
    <div className={styles.usageEvent} data-testid="usage-event">
      <span className={styles.usageBadge}>{label}</span>
    </div>
  );
}

/** Renders an unrecognized event type. */
function DefaultEvent({ content }: { content: string }): JSX.Element {
  return <div className={styles.defaultEvent}>{content}</div>;
}

// --- Main component ---

/** Renders a single session event, dispatching to the appropriate type-specific renderer. */
export function EventRenderer({
  event,
  toolUseCtx,
  settled,
  sandboxProxyUrl,
  onOpenDocument,
}: Props): JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString();

  switch (event.eventType) {
    case "widget": {
      // MCP Apps widget event (pushed by the broker). Self-contained: HTML +
      // tool input/result. Renders in the cross-origin sandbox via McpAppWidget.
      if (!sandboxProxyUrl) {
        return <DefaultEvent content={event.content} />;
      }
      let payload: {
        html?: string;
        rendererKind?: string;
        // `allowInlineScripts`/`allowUnsafeEval` are Grackle extensions to the
        // upstream CSP type (agent-authored widgets #1239; React runtime #1268);
        // forwarded verbatim to the sandbox.
        csp?: McpUiResourceCsp & { allowInlineScripts?: boolean; allowUnsafeEval?: boolean };
        toolInput?: Record<string, unknown>;
        toolResult?: CallToolResult;
        // Resolved registry dependencies for composition (#1270), eval order.
        components?: Array<{ name: string; body: string }>;
      } = {};
      try {
        payload = JSON.parse(event.content) as typeof payload;
      } catch {
        /* malformed widget payload — fall back */
      }
      // Dispatch on rendererKind (default "mcp-app-html" for back-compat). This
      // switch is the seam for declarative/runtime renderers.
      const rendererKind: string = payload.rendererKind ?? "mcp-app-html";
      // GenUX React runtime (#1268): payload.html is JSX *source* (not a full
      // document). Render it via a bootstrap that loads the runtime bundle from the
      // sandbox origin; the source + props are delivered as tool input. The runtime
      // transpiles + renders the component against the Grackle component library.
      // An absolute runtime.js URL is required — the inner iframe is written via
      // doc.write (about:blank base), so a relative "/runtime.js" would not resolve.
      if (rendererKind === "grackle-react" && payload.html) {
        const sandboxOrigin: string = new URL(sandboxProxyUrl, window.location.href).origin;
        const bootstrap: string =
          `<!doctype html><html><head><meta charset="utf-8"></head>` +
          `<body><div id="grackle-root"></div>` +
          `<script type="module" src="${sandboxOrigin}/runtime.js"></script></body></html>`;
        return (
          <Suspense fallback={<DefaultEvent content="Loading widget..." />}>
            <McpAppWidget
              widgetHtml={bootstrap}
              sandboxProxyUrl={sandboxProxyUrl}
              csp={payload.csp}
              toolInput={{
                source: payload.html,
                props: payload.toolInput ?? {},
                components: payload.components ?? [],
              }}
            />
          </Suspense>
        );
      }
      if (rendererKind !== "mcp-app-html" || !payload.html) {
        return <DefaultEvent content={event.content} />;
      }
      return (
        <Suspense fallback={<DefaultEvent content="Loading widget..." />}>
          <McpAppWidget
            widgetHtml={payload.html}
            sandboxProxyUrl={sandboxProxyUrl}
            csp={payload.csp}
            toolInput={payload.toolInput}
            toolResult={payload.toolResult}
          />
        </Suspense>
      );
    }
    case "system": {
      // Detect system context events via the raw metadata marker
      if (event.raw) {
        try {
          const rawData = JSON.parse(event.raw) as Record<string, unknown>;
          if (rawData.systemContext === true) {
            return <SystemContextEvent content={event.content} />;
          }
        } catch {
          /* not JSON, render as normal system event */
        }
      }
      return <SystemEvent time={time} content={event.content} />;
    }
    case "text":
    case "output":
      return <TextEvent content={event.content} onOpenDocument={onOpenDocument} />;
    case "tool_use": {
      let tool = "";
      let args: unknown = {};
      try {
        const parsed = JSON.parse(event.content) as { tool?: string; args?: unknown };
        tool = parsed.tool || "";
        args = parsed.args;
      } catch {
        /* fallback to empty */
      }
      // When settled, pass empty result so the card shows as completed (no spinner)
      // rather than in-progress. This handles Claude Code which emits results as text.
      return (
        <ToolCard
          tool={tool}
          args={args}
          result={settled ? "" : undefined}
          childSessionId={delegationChildId(event.sessionId, event.toolCallId, tool, args)}
          onOpenDocument={onOpenDocument}
        />
      );
    }
    case "tool_result": {
      // When paired, toolUseCtx provides the tool name, args, and optional detailedResult.
      // When unpaired, fall back to a generic display.
      //
      // Error detection (#1362): prefer the first-class `toolError` field,
      // set by every runtime adapter from its native outcome signal and
      // carried across the AHP wire as `result.success`. Fall back to the
      // structured `content.is_ok === false` shape the reverse mapper writes
      // (HR8d #1355), then to the legacy `raw.is_error` path for pre-HR8d
      // JSONL replay.
      let isError = event.toolError === true;
      if (!isError) {
        try {
          const parsed = JSON.parse(event.content) as Record<string, unknown>;
          if (parsed.is_ok === false) {
            isError = true;
          }
        } catch {
          /* content not JSON — fall through to legacy raw check */
        }
      }
      if (!isError && event.raw) {
        try {
          const rawData = JSON.parse(event.raw) as Record<string, unknown>;
          isError = rawData.is_error === true;
        } catch {
          /* ignore */
        }
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
        } catch {
          /* content looks like JSON but isn't — use as-is */
        }
      }

      if (toolUseCtx) {
        return (
          <ToolCard
            tool={toolUseCtx.tool}
            args={toolUseCtx.args}
            result={resultContent}
            isError={isError}
            detailedResult={toolUseCtx.detailedResult}
            childSessionId={delegationChildId(
              event.sessionId,
              event.toolCallId,
              toolUseCtx.tool,
              toolUseCtx.args,
            )}
            onOpenDocument={onOpenDocument}
          />
        );
      }
      // Unpaired tool_result — use generic card with fallback label
      return (
        <ToolCard
          tool="Tool output"
          args={undefined}
          result={resultContent}
          isError={isError}
          onOpenDocument={onOpenDocument}
        />
      );
    }
    case "error":
      return <ErrorEvent content={event.content} />;
    case "status":
      return <StatusEvent content={event.content} />;
    case "user_input":
    case "turn_started":
      return <UserInputEvent content={event.content} />;
    case "turn_complete":
      return <></>;
    case "signal":
      return <SignalEvent content={event.content} />;
    case "usage":
      return <UsageEvent content={event.content} />;
    default:
      return <DefaultEvent content={event.content} />;
  }
}

import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { extractBareName } from "./classifyTool.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";

/** Shape of a file descriptor entry from ipc_list_fds. */
interface FdEntry {
  fd?: number;
  streamName?: string;
  permission?: string;
  deliveryMode?: string;
  owned?: boolean;
  targetSessionId?: string;
}

/** Extracts IPC-relevant fields from tool args. */
function getArgs(args: unknown): { fd?: number; pipe?: string; prompt?: string; name?: string; message?: string } {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  return {
    fd: typeof a.fd === "number" ? a.fd : undefined,
    pipe: typeof a.pipe === "string" ? a.pipe : undefined,
    prompt: typeof a.prompt === "string" ? a.prompt : undefined,
    name: typeof a.name === "string" ? a.name : undefined,
    message: typeof a.message === "string" ? a.message : undefined,
  };
}

/** Parses IPC result JSON. */
function parseResult(result: string | undefined): { sessionId?: string; fd?: number; fds?: FdEntry[]; success?: boolean; output?: string } {
  if (!result) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    return {
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
      fd: typeof obj.fd === "number" ? obj.fd : undefined,
      fds: Array.isArray(obj.fds) ? (obj.fds as unknown[]).filter((v): v is FdEntry => v !== null && typeof v === "object") : undefined,
      success: typeof obj.success === "boolean" ? obj.success : undefined,
      output: typeof obj.output === "string" ? obj.output : undefined,
    };
  } catch { /* fall through */ }
  return {};
}

/** Renders an IPC tool call with structured display. */
export function IpcCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bareName = extractBareName(tool);
  const argData = getArgs(args);
  const inProgress = result === undefined;
  const resultData = parseResult(result);

  // Build a descriptor for the header
  let headerInfo = "";
  if (argData.pipe) {
    headerInfo = `[${argData.pipe}]`;
  } else if (argData.fd !== undefined) {
    headerInfo = `fd:${argData.fd}`;
  } else if (argData.name) {
    headerInfo = `"${argData.name}"`;
  }

  // Prompt snippet for ipc_spawn
  const promptSnippet = argData.prompt
    ? (argData.prompt.length > 60 ? `${argData.prompt.slice(0, 60)}...` : argData.prompt)
    : undefined;

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardOrange} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-ipc"
    >
      <div className={styles.header}>
        <span className={styles.icon} aria-hidden="true">&#x1F500;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-yellow, #fbbf24)" }}>
          {bareName}
        </span>
        {headerInfo && (
          <span className={styles.fileName} data-testid="tool-card-ipc-info">
            {headerInfo}
          </span>
        )}
        {promptSnippet && (
          <span className={styles.fileName} title={argData.prompt} data-testid="tool-card-ipc-prompt">
            {promptSnippet}
          </span>
        )}
        {resultData.fds && (
          <>
            <span className={styles.spacer} />
            <span className={styles.badge} data-testid="tool-card-ipc-fd-count">
              {resultData.fds.length} {resultData.fds.length === 1 ? "fd" : "fds"}
            </span>
          </>
        )}
        {resultData.success !== undefined && !resultData.fds && (
          <>
            <span className={styles.spacer} />
            <span
              className={styles.badge}
              style={{ color: resultData.success ? "var(--accent-green, #4ade80)" : "var(--accent-red, #f87171)" }}
              data-testid="tool-card-ipc-success"
            >
              {resultData.success ? "\u2713 ok" : "\u2717 failed"}
            </span>
          </>
        )}
        {!inProgress && !isError && result && (
          <CopyButton text={result} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* In-progress: show args if nothing else to show */}
      {inProgress && !promptSnippet && !headerInfo && args !== null && args !== undefined && (
        <pre className={styles.pre} data-testid="tool-card-args">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      {/* Error */}
      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {/* Session ID from ipc_spawn */}
      {!isError && resultData.sessionId && (
        <div className={styles.pre} style={{ padding: "4px 8px", fontSize: "0.85em" }} data-testid="tool-card-ipc-session">
          session: {resultData.sessionId}
          {resultData.fd !== undefined && ` | fd: ${resultData.fd}`}
        </div>
      )}

      {/* Output from sync ipc_spawn */}
      {!isError && resultData.output && (
        <pre className={styles.pre} data-testid="tool-card-ipc-output">
          {resultData.output}
        </pre>
      )}

      {/* FD listing from ipc_list_fds */}
      {!isError && resultData.fds && resultData.fds.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-ipc-fds">
            {(expanded ? resultData.fds : resultData.fds.slice(0, 5)).map((f) => {
              const parts = [`fd:${f.fd ?? "?"}`, f.permission ?? "", f.deliveryMode ?? ""];
              if (f.streamName) {
                parts.push(f.streamName);
              }
              if (f.owned) {
                parts.push("(owned)");
              }
              return parts.filter(Boolean).join(" ");
            }).join("\n")}
          </pre>
          {resultData.fds.length > 5 && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#x25B8;</span>
              {expanded ? "collapse" : `${resultData.fds.length - 5} more fds`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

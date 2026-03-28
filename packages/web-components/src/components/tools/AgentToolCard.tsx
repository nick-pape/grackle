import { useState, type JSX } from "react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { CopyButton } from "../display/CopyButton.js";
import styles from "./toolCards.module.scss";
import agentStyles from "./AgentToolCard.module.scss";

/** Normalized info extracted from agent tool args across runtimes. */
interface AgentInfo {
  /** Agent type: "Explore", "Plan", "general-purpose", "explore", "worker", etc. */
  agentType?: string;
  /** Short description of the subagent task. */
  description?: string;
  /** Full prompt sent to the subagent. */
  prompt?: string;
  /** Whether the subagent runs in the background. */
  isBackground?: boolean;
  /** Model override (e.g. "sonnet", "opus", "claude-sonnet-4-20250514"). */
  model?: string;
  /** Copilot: human-readable agent name (e.g. "find-tests"). */
  agentName?: string;
  /** Copilot read_agent: the agent_id being polled. */
  agentId?: string;
  /** Whether this is a resume of a prior subagent. */
  isResume?: boolean;
  /** Whether this is a read_agent poll (not a spawn). */
  isPoll?: boolean;
}

/**
 * Parses agent tool args from all supported runtimes into a normalized shape.
 *
 * Handles:
 * - Claude Code `Agent` / `Task`: `{ subagent_type, description, prompt, run_in_background, model, resume }`
 * - Copilot `task`: `{ agent_type, description, prompt, mode, name }`
 * - Copilot `read_agent`: `{ agent_id }`
 */
function parseAgentArgs(tool: string, args: unknown): AgentInfo {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  const toolLower = tool.toLowerCase();

  // Copilot read_agent — polling a background agent
  if (toolLower === "read_agent") {
    return {
      agentId: typeof a.agent_id === "string" ? a.agent_id : undefined,
      isPoll: true,
    };
  }

  // Copilot task — has `agent_type` and `name` fields
  if (typeof a.agent_type === "string" || typeof a.name === "string") {
    return {
      agentType: typeof a.agent_type === "string" ? a.agent_type : undefined,
      description: typeof a.description === "string" ? a.description : undefined,
      prompt: typeof a.prompt === "string" ? a.prompt : undefined,
      isBackground: a.mode === "background",
      agentName: typeof a.name === "string" ? a.name : undefined,
    };
  }

  // Claude Code Agent / Task — has `subagent_type` field
  return {
    agentType: typeof a.subagent_type === "string" ? a.subagent_type : undefined,
    description: typeof a.description === "string" ? a.description : undefined,
    prompt: typeof a.prompt === "string" ? a.prompt : undefined,
    isBackground: a.run_in_background === true,
    model: typeof a.model === "string" ? a.model : undefined,
    isResume: typeof a.resume === "string" && a.resume.length > 0,
  };
}

/** Regex to parse Copilot read_agent structured result prefix. */
const READ_AGENT_STATUS_PATTERN: RegExp =
  /^Agent\s+(completed|running|failed|error)\.\s*agent_id:\s*(\S+),?\s*([^\n]*)(?:\n\n([\s\S]*))?$/i;

/** Parsed result from a Copilot read_agent poll. */
interface ReadAgentResult {
  /** Agent lifecycle status. */
  status: string;
  /** The agent_id that was polled. */
  agentId: string;
  /** Metadata line (e.g. "elapsed: 6s, total_turns: 0, duration: 4s"). */
  metadata: string;
  /** The actual content after the status prefix. */
  content?: string;
}

/** Attempts to parse the structured prefix from a read_agent result. */
function parseReadAgentResult(result: string): ReadAgentResult | undefined {
  const match = READ_AGENT_STATUS_PATTERN.exec(result);
  if (!match) {
    return undefined;
  }
  const rawContent: string | undefined = match[4] as string | undefined;
  return {
    status: match[1].toLowerCase(),
    agentId: match[2].replace(/,$/, ""),
    metadata: match[3].trim(),
    content: rawContent ? rawContent.trim() : undefined,
  };
}

/** Number of result lines shown when collapsed. */
const PREVIEW_LINES: number = 5;

/** Renders a subagent tool call (Claude Code Agent, Copilot task/read_agent). */
export function AgentToolCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const info = parseAgentArgs(tool, args);
  const inProgress = result === undefined;

  // For read_agent, try to parse the structured result
  const parsedPoll = info.isPoll && result ? parseReadAgentResult(result) : undefined;
  const displayResult = parsedPoll?.content ?? result;

  const resultLines = displayResult?.split("\n") ?? [];
  const hasMore = resultLines.length > PREVIEW_LINES;
  const visibleResult = expanded ? displayResult : resultLines.slice(0, PREVIEW_LINES).join("\n");

  // Header label
  const headerLabel = info.isPoll ? "Subagent" : "Agent";

  return (
    <div
      className={`${styles.card} ${isError ? styles.cardRed : styles.cardTeal} ${inProgress ? styles.inProgress : ""}`}
      data-testid="tool-card-agent"
    >
      {/* Header row */}
      <div className={styles.header}>
        <span className={styles.icon} style={{ color: "var(--accent-teal, #2dd4bf)" }}>&#9654;</span>
        <span className={styles.toolName} style={{ color: "var(--accent-teal, #2dd4bf)" }}>
          {headerLabel}
        </span>

        {info.agentType && (
          <span className={agentStyles.badgePill} data-testid="tool-card-agent-type">
            {info.agentType}
          </span>
        )}

        {info.model && (
          <span className={agentStyles.modelBadge} data-testid="tool-card-agent-model">
            {info.model}
          </span>
        )}

        {info.isBackground && (
          <span className={agentStyles.backgroundBadge} data-testid="tool-card-agent-background">
            <span className={inProgress ? agentStyles.backgroundDotPulsing : agentStyles.backgroundDot}>&#9679;</span>
            BG
          </span>
        )}

        {info.agentName && (
          <span className={styles.fileName} data-testid="tool-card-agent-name">
            {info.agentName}
          </span>
        )}

        {info.agentId && (
          <span className={styles.fileName} data-testid="tool-card-agent-id">
            {info.agentId}
          </span>
        )}

        <span className={styles.spacer} />

        {inProgress && !info.isBackground && (
          <span className={styles.exitPending} data-testid="tool-card-pending">&#9679;</span>
        )}

        {!inProgress && !isError && displayResult && (
          <CopyButton text={displayResult} data-testid="tool-card-copy" className={styles.copyButtonInline} />
        )}
      </div>

      {/* Description */}
      {info.description && (
        <div className={agentStyles.description} data-testid="tool-card-agent-description">
          {info.isResume ? `Resuming: ${info.description}` : info.description}
        </div>
      )}

      {/* read_agent status line */}
      {parsedPoll && (
        <div className={agentStyles.statusLine} data-testid="tool-card-agent-status">
          <span className={
            parsedPoll.status === "completed" ? agentStyles.statusCompleted
              : parsedPoll.status === "running" ? agentStyles.statusRunning
                : agentStyles.statusError
          }>
            {parsedPoll.status}
          </span>
          {parsedPoll.metadata && <span>{parsedPoll.metadata}</span>}
        </div>
      )}

      {/* Collapsible prompt */}
      {info.prompt && (
        <>
          <button
            type="button"
            className={agentStyles.promptToggle}
            onClick={() => { setPromptExpanded((v) => !v); }}
            aria-expanded={promptExpanded}
            data-testid="tool-card-prompt-toggle"
          >
            <span className={`${styles.chevron} ${promptExpanded ? styles.chevronExpanded : ""}`}>&#9656;</span>
            prompt
          </button>
          {promptExpanded && (
            <pre className={styles.pre} data-testid="tool-card-prompt">
              {info.prompt}
            </pre>
          )}
        </>
      )}

      {/* Error result */}
      {isError && result && (
        <pre className={styles.pre} data-testid="tool-card-error">
          {result}
        </pre>
      )}

      {/* Normal result */}
      {!isError && !inProgress && displayResult && (
        <>
          <pre className={styles.pre} data-testid="tool-card-result">
            {visibleResult}
          </pre>
          {hasMore && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>&#9656;</span>
              {expanded ? "collapse" : `${resultLines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

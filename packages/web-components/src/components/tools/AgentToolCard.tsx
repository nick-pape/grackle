import { useState, type JSX } from "react";
import { Link } from "react-router";
import { parseDelegationArgs } from "@grackle-ai/common";
import { sessionUrl } from "../../utils/navigation.js";
import type { ToolCardProps } from "./ToolCardProps.js";
import styles from "./toolCards.module.scss";
import agentStyles from "./AgentToolCard.module.scss";

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
export function AgentToolCard({
  tool,
  args,
  result,
  isError,
  childSessionId,
}: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const info = parseDelegationArgs(tool, args);
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
        <span className={styles.icon} style={{ color: "var(--accent-teal, #2dd4bf)" }}>
          &#9654;
        </span>
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
            <span
              className={inProgress ? agentStyles.backgroundDotPulsing : agentStyles.backgroundDot}
            >
              &#9679;
            </span>
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

        {childSessionId && (
          <Link
            to={sessionUrl(childSessionId)}
            className={agentStyles.viewActivity}
            data-testid="tool-card-agent-view-activity"
          >
            View activity &#8594;
          </Link>
        )}

        {inProgress && !info.isBackground && (
          <span className={styles.exitPending} data-testid="tool-card-pending">
            &#9679;
          </span>
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
          <span
            className={
              parsedPoll.status === "completed"
                ? agentStyles.statusCompleted
                : parsedPoll.status === "running"
                  ? agentStyles.statusRunning
                  : agentStyles.statusError
            }
          >
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
            onClick={() => {
              setPromptExpanded((v) => !v);
            }}
            aria-expanded={promptExpanded}
            data-testid="tool-card-prompt-toggle"
          >
            <span className={`${styles.chevron} ${promptExpanded ? styles.chevronExpanded : ""}`}>
              &#9656;
            </span>
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
              onClick={() => {
                setExpanded((v) => !v);
              }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>
                &#9656;
              </span>
              {expanded ? "collapse" : `${resultLines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

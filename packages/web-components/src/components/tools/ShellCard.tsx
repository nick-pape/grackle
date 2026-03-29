import { useState, type JSX } from "react";
import { Check, ChevronRight, Loader, X } from "lucide-react";
import type { ToolCardProps } from "./ToolCardProps.js";
import { parseShellOutput } from "./parseShellOutput.js";
import { ICON_SM } from "../../utils/iconSize.js";
import styles from "./toolCards.module.scss";

/** Extracts the command string from shell tool args. */
function getCommand(args: unknown): string {
  if (args === null || args === undefined || typeof args !== "object") {
    return "";
  }
  const a = args as Record<string, unknown>;
  if (typeof a.command === "string") {
    return a.command;
  }
  return "";
}

/**
 * Simplifies a shell command for display.
 *
 * Strips PowerShell wrappers like `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'inner'`
 * down to just the inner command.
 */
function simplifyCommand(cmd: string): string {
  // Match: "...pwsh.exe" -Command 'inner command'
  const pwshMatch = /pwsh(?:\.exe)?["']?\s+-Command\s+'(.+?)'\s*$/i.exec(cmd);
  if (pwshMatch) {
    return pwshMatch[1];
  }
  // Match: "...pwsh.exe" -Command "inner command"
  const pwshMatch2 = /pwsh(?:\.exe)?["']?\s+-Command\s+"(.+?)"\s*$/i.exec(cmd);
  if (pwshMatch2) {
    return pwshMatch2[1];
  }
  return cmd;
}

/** Number of output lines shown when collapsed. */
const PREVIEW_LINES: number = 3;

/** Renders a shell command tool call with terminal-style output. */
export function ShellCard({ tool, args, result, isError }: ToolCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const rawCommand = getCommand(args);
  const command = simplifyCommand(rawCommand);
  const inProgress = result === undefined;

  const parsed = result ? parseShellOutput(result) : null;
  const outputLines = parsed?.output.split("\n") ?? [];
  const hasMore = outputLines.length > PREVIEW_LINES;
  const displayLines = expanded ? outputLines : outputLines.slice(0, PREVIEW_LINES);
  const exitCode: number | undefined = parsed?.exitCode;
  const derivedIsError: boolean = isError || (exitCode !== undefined && exitCode !== 0);

  return (
    <div
      className={`${styles.card} ${derivedIsError ? styles.cardRed : styles.cardNeutral}`}
      data-testid="tool-card-shell"
    >
      <div className={styles.header}>
        <span className={styles.icon} style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontWeight: "bold" }}>$</span>
        <span
          className={styles.fileName}
          style={{ flex: 1, color: "var(--text-primary)" }}
          title={rawCommand !== command ? rawCommand : undefined}
          data-testid="tool-card-command"
        >
          {command}
        </span>
        {exitCode !== undefined && (
          <span
            className={exitCode === 0 ? styles.exitOk : styles.exitError}
            data-testid="tool-card-exit-code"
          >
            {exitCode === 0 ? <Check size={ICON_SM} aria-hidden="true" /> : <X size={ICON_SM} aria-hidden="true" />}{" "}exit {exitCode}
          </span>
        )}
        {inProgress && (
          <span className={styles.exitPending} data-testid="tool-card-pending"><Loader size={ICON_SM} aria-hidden="true" /></span>
        )}
      </div>

      {!inProgress && parsed && parsed.output.length > 0 && (
        <>
          <pre className={styles.pre} data-testid="tool-card-output">
            {displayLines.join("\n")}
          </pre>
          {hasMore && (
            <button
              type="button"
              className={styles.bodyToggle}
              onClick={() => { setExpanded((v) => !v); }}
              aria-expanded={expanded}
              data-testid="tool-card-toggle"
            >
              <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`} aria-hidden="true"><ChevronRight size={ICON_SM} /></span>
              {expanded ? "collapse" : `${outputLines.length - PREVIEW_LINES} more lines`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

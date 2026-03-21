import { useState, type FormEvent, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import type { Environment } from "../../hooks/useGrackleSocket.js";
import styles from "./ChatInput.module.scss";

// --- Helpers ---

/** Returns true when the environment with the given ID is disconnected or in error. */
function isEnvDisconnected(environmentId: string | undefined, environments: Environment[]): boolean {
  if (!environmentId) {
    return false;
  }
  const env = environments.find((e) => e.id === environmentId);
  return env !== undefined && (env.status === "disconnected" || env.status === "error");
}

// --- Subcomponents ---

interface DisconnectedBannerProps {
  environmentId: string;
  onReconnect: (envId: string) => void;
}

/** Hint + Reconnect button shown when the task/session environment is unreachable. */
function DisconnectedBanner({ environmentId, onReconnect }: DisconnectedBannerProps): JSX.Element {
  return (
    <>
      <span className={styles.disconnectHint} data-testid="env-disconnect-hint">
        Environment unavailable
      </span>
      <button
        type="button"
        onClick={() => onReconnect(environmentId)}
        className={styles.btnGhost}
        data-testid="reconnect-btn"
        title="Reconnect the environment to resume messaging"
      >
        Reconnect
      </button>
    </>
  );
}

// --- Main component ---

/** Chat input mode determines the action performed on submit. */
export interface ChatInputProps {
  /** "send" = sendInput to existing session, "spawn" = create new session, "start" = start a task */
  mode: "send" | "spawn" | "start";
  /** Session ID to send input to (mode="send") */
  sessionId?: string;
  /** Environment ID (mode="spawn" and "start") */
  environmentId?: string;
  /** Task ID to start (mode="start") */
  taskId?: string;
  /** Show Stop button */
  showStop?: boolean;
  /** Show persona selector dropdown (mode="spawn") */
  showPersonaSelect?: boolean;
  /** Callback for Stop button */
  onSessionKill?: () => void;
}

/** Reusable form component for sending messages to agent sessions. */
export function ChatInput({
  mode,
  sessionId,
  environmentId,
  taskId,
  showStop,
  showPersonaSelect,
  onSessionKill,
}: ChatInputProps): JSX.Element {
  const {
    sendInput, spawn, startTask, personas, environments, provisionEnvironment,
  } = useGrackle();
  const { showToast } = useToast();

  const [text, setText] = useState("");
  const [spawnPersonaId, setSpawnPersonaId] = useState("");

  const envDisconnected = isEnvDisconnected(environmentId, environments);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!text.trim()) {
      return;
    }

    if (mode === "send") {
      if (!sessionId || envDisconnected) {
        return;
      }
      sendInput(sessionId, text);
      setText("");
    } else if (mode === "spawn") {
      if (!environmentId) {
        return;
      }
      spawn(environmentId, text, spawnPersonaId);
      showToast("Session started", "success");
      setText("");
      setSpawnPersonaId("");
    } else {
      // mode === "start"
      if (!taskId) {
        return;
      }
      startTask(taskId, undefined, environmentId, text);
      setText("");
    }
  };

  // --- spawn mode ---
  if (mode === "spawn") {
    return (
      <form onSubmit={handleSubmit} className={styles.bar}>
        <span className={styles.badge}>
          new chat
        </span>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter prompt..." autoFocus className={styles.input} />
        {showPersonaSelect && (
          <select value={spawnPersonaId} onChange={(e) => setSpawnPersonaId(e.target.value)} className={styles.select}>
            <option value="">(Default)</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <button type="submit" disabled={!text.trim() || !environmentId} className={styles.btnPrimary}>Go</button>
      </form>
    );
  }

  // --- start mode ---
  if (mode === "start") {
    return (
      <form onSubmit={handleSubmit} className={styles.bar}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus className={styles.input} />
        <button type="submit" disabled={!text.trim()} className={styles.btnPrimary}>Send</button>
      </form>
    );
  }

  // --- send mode ---
  return (
    <form onSubmit={handleSubmit} className={styles.bar}>
      {envDisconnected && environmentId && (
        <DisconnectedBanner environmentId={environmentId} onReconnect={provisionEnvironment} />
      )}
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus={!envDisconnected} disabled={envDisconnected} className={styles.input} />
      <span title={envDisconnected ? "Environment is unavailable — reconnect first" : undefined}>
        <button type="submit" disabled={!text.trim() || envDisconnected} className={styles.btnPrimary}>Send</button>
      </span>
      {showStop && onSessionKill && (
        <button type="button" onClick={onSessionKill} className={styles.btnDanger} title="Stop session">Stop</button>
      )}
    </form>
  );
}

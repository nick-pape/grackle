import {
  useState,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type JSX,
} from "react";
import type { ToastVariant } from "../../context/ToastContext.js";
import type { Environment, PersonaData } from "../../hooks/types.js";
import styles from "./ChatInput.module.scss";

/**
 * Maximum height (px) the composer grows to before scrolling internally.
 * Must stay in sync with `max-height` on `.textarea` in ChatInput.module.scss.
 */
const MAX_COMPOSER_HEIGHT_PX: number = 200;

// --- Helpers ---

/** Returns true when the environment with the given ID is disconnected or in error. */
function isEnvDisconnected(
  environmentId: string | undefined,
  environments: Environment[],
): boolean {
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

/** Props for the auto-resizing chat composer textarea. */
interface ComposerTextAreaProps {
  /** Current text value. */
  value: string;
  /** Called on every keystroke with the new value. */
  onChange: (value: string) => void;
  /** Called when the user submits via Enter (Shift+Enter inserts a newline). */
  onSubmit: () => void;
  /** Placeholder text shown when empty. */
  placeholder: string;
  /** Whether the textarea is disabled. */
  disabled?: boolean;
  /** Whether to auto-focus the textarea on mount. */
  autoFocus?: boolean;
  /** Accessible label for the textarea. */
  ariaLabel: string;
}

/**
 * Auto-resizing multiline chat composer.
 *
 * Enter submits; Shift+Enter inserts a newline (the Send button submits too).
 * The textarea grows with its content up to {@link MAX_COMPOSER_HEIGHT_PX}, then
 * scrolls internally.
 */
function ComposerTextArea({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  autoFocus,
  ariaLabel,
}: ComposerTextAreaProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: collapse to measure natural height, then grow to fit (capped).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter submits; Shift+Enter falls through to insert a newline.
    // The isComposing guard avoids submitting mid-IME composition (e.g. CJK input).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={styles.textarea}
      aria-label={ariaLabel}
    />
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
  /** Show persona selector dropdown (mode="spawn") */
  showPersonaSelect?: boolean;
  /** All personas (for persona selector in spawn mode). */
  personas: PersonaData[];
  /** All environments (for disconnect detection). */
  environments: Environment[];
  /** Send text input to an existing session. */
  onSendInput: (sessionId: string, text: string) => void;
  /** Spawn a new session. */
  onSpawn: (environmentId: string, prompt: string, personaId?: string) => void;
  /** Start a task. */
  onStartTask: (taskId: string, personaId?: string, environmentId?: string, notes?: string) => void;
  /** Reconnect a disconnected environment. */
  onProvisionEnvironment: (environmentId: string) => void;
  /** Display a toast notification. */
  onShowToast?: (message: string, variant?: ToastVariant) => void;
}

/** Reusable form component for sending messages to agent sessions. */
export function ChatInput({
  mode,
  sessionId,
  environmentId,
  taskId,
  showPersonaSelect,
  personas,
  environments,
  onSendInput,
  onSpawn,
  onStartTask,
  onProvisionEnvironment,
  onShowToast,
}: ChatInputProps): JSX.Element {
  const [text, setText] = useState("");
  const [spawnPersonaId, setSpawnPersonaId] = useState("");

  const envDisconnected = isEnvDisconnected(environmentId, environments);

  /** Performs the mode-specific submit action. Called by the form and Enter key. */
  const submit = (): void => {
    if (!text.trim()) {
      return;
    }

    if (mode === "send") {
      if (!sessionId || envDisconnected) {
        return;
      }
      onSendInput(sessionId, text);
      setText("");
    } else if (mode === "spawn") {
      if (!environmentId) {
        return;
      }
      onSpawn(environmentId, text, spawnPersonaId);
      onShowToast?.("Session started", "success");
      setText("");
      setSpawnPersonaId("");
    } else {
      // mode === "start"
      if (!taskId) {
        return;
      }
      onStartTask(taskId, undefined, environmentId, text);
      setText("");
    }
  };

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    submit();
  };

  // --- spawn mode ---
  if (mode === "spawn") {
    return (
      <form onSubmit={handleSubmit} className={styles.bar}>
        <span className={styles.badge}>new chat</span>
        <ComposerTextArea
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder="Enter prompt..."
          autoFocus
          ariaLabel="Enter prompt"
        />
        {showPersonaSelect && (
          <select
            value={spawnPersonaId}
            onChange={(e) => setSpawnPersonaId(e.target.value)}
            className={styles.select}
            aria-label="Select persona"
          >
            <option value="">(Default)</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={!text.trim() || !environmentId}
          className={styles.btnPrimary}
        >
          Go
        </button>
      </form>
    );
  }

  // --- start mode ---
  if (mode === "start") {
    return (
      <form onSubmit={handleSubmit} className={styles.bar}>
        <ComposerTextArea
          value={text}
          onChange={setText}
          onSubmit={submit}
          placeholder="Type a message..."
          autoFocus
          ariaLabel="Type a message"
        />
        <button type="submit" disabled={!text.trim()} className={styles.btnPrimary}>
          Send
        </button>
      </form>
    );
  }

  // --- send mode ---
  return (
    <form onSubmit={handleSubmit} className={styles.bar}>
      {envDisconnected && environmentId && (
        <DisconnectedBanner environmentId={environmentId} onReconnect={onProvisionEnvironment} />
      )}
      <ComposerTextArea
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder="Type a message..."
        autoFocus={!envDisconnected}
        disabled={envDisconnected}
        ariaLabel="Type a message"
      />
      <span title={envDisconnected ? "Environment is unavailable — reconnect first" : undefined}>
        <button
          type="submit"
          disabled={!text.trim() || envDisconnected}
          className={styles.btnPrimary}
        >
          Send
        </button>
      </span>
    </form>
  );
}

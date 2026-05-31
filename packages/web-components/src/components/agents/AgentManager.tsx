/**
 * AgentManager — presentational create form and read-only detail view for
 * standing agents (#1417, Phase 0). Pure: it takes data plus callbacks and
 * never touches the router or `useGrackle`.
 *
 * @module
 */

import { useState, type FormEvent, type JSX } from "react";
import type { AgentData, PersonaData } from "../../hooks/types.js";
import { Button } from "../display/Button.js";
import styles from "./AgentManager.module.scss";

/** Props for {@link AgentManager}. */
export interface AgentManagerProps {
  /** All agents (used to resolve the one named by `agentId` in view mode). */
  agents: AgentData[];
  /** Personas available to be chosen as the primary persona. */
  personas: PersonaData[];
  /** When set and found in `agents`, render the read-only view; else create form. */
  agentId?: string;
  /** Create a new agent. Called only in create mode. */
  onCreate: (name: string, avatar: string, primaryPersonaId: string) => void;
  /** Delete the viewed agent. Called only in view mode. */
  onDelete: (id: string) => void;
  /** Navigate away (after create/delete, or via the back affordance). */
  onNavigateBack: () => void;
}

/** True when the avatar string points to an image rather than an inline glyph. */
function isImageAvatar(avatar: string): boolean {
  return (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("/") ||
    avatar.startsWith("data:")
  );
}

/** Render an agent's avatar: image, emoji glyph, or a name-derived monogram. */
function AvatarPreview({ name, avatar }: { name: string; avatar: string }): JSX.Element {
  if (avatar && isImageAvatar(avatar)) {
    return <img className={styles.avatar} src={avatar} alt="" data-testid="agent-avatar-image" />;
  }
  const glyph = avatar || (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true" data-testid="agent-avatar-glyph">
      {glyph}
    </span>
  );
}

/**
 * Create form (no `agentId`) or read-only detail view (valid `agentId`).
 */
export function AgentManager({
  agents,
  personas,
  agentId,
  onCreate,
  onDelete,
  onNavigateBack,
}: AgentManagerProps): JSX.Element {
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;

  // ── Read-only view ───────────────────────────────────────────────────────
  if (agentId && agent) {
    const persona = personas.find((p) => p.id === agent.primaryPersonaId);
    return (
      <div className={styles.container} data-testid="agent-view">
        <div className={styles.header}>
          <AvatarPreview name={agent.name} avatar={agent.avatar} />
          <h1 className={styles.title} data-testid="agent-name">
            {agent.name}
          </h1>
        </div>
        <dl className={styles.fields}>
          <dt>Primary persona</dt>
          <dd data-testid="agent-persona">
            {persona ? persona.name : agent.primaryPersonaId || "(none)"}
          </dd>
        </dl>
        <section className={styles.history} data-testid="agent-history">
          <h2 className={styles.sectionTitle}>History</h2>
          <p className={styles.placeholder}>
            This agent has no lifecycle yet. Activity will appear here once standing agents can run.
          </p>
        </section>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onNavigateBack} data-testid="agent-back">
            Back
          </Button>
          <Button variant="danger" onClick={() => onDelete(agent.id)} data-testid="agent-delete">
            Delete
          </Button>
        </div>
      </div>
    );
  }

  // ── Create form ──────────────────────────────────────────────────────────
  return <AgentCreateForm personas={personas} onCreate={onCreate} onCancel={onNavigateBack} />;
}

/** Props for the internal create form. */
interface AgentCreateFormProps {
  personas: PersonaData[];
  onCreate: (name: string, avatar: string, primaryPersonaId: string) => void;
  onCancel: () => void;
}

/** Controlled create form for a new agent. */
function AgentCreateForm({ personas, onCreate, onCancel }: AgentCreateFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [primaryPersonaId, setPrimaryPersonaId] = useState("");

  const canSubmit = name.trim().length > 0;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    onCreate(name.trim(), avatar.trim(), primaryPersonaId);
  };

  return (
    <form className={styles.container} onSubmit={handleSubmit} data-testid="agent-create-form">
      <div className={styles.header}>
        <AvatarPreview name={name || "?"} avatar={avatar} />
        <h1 className={styles.title}>Create Agent</h1>
      </div>

      <label className={styles.label} htmlFor="agent-name-input">
        Name
      </label>
      <input
        id="agent-name-input"
        className={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Refactor Bot"
        data-testid="agent-name-input"
        autoFocus
      />

      <label className={styles.label} htmlFor="agent-avatar-input">
        Avatar <span className={styles.hint}>(emoji, URL, or data URI)</span>
      </label>
      <input
        id="agent-avatar-input"
        className={styles.input}
        value={avatar}
        onChange={(e) => setAvatar(e.target.value)}
        placeholder="(optional)"
        data-testid="agent-avatar-input"
      />

      <label className={styles.label} htmlFor="agent-persona-select">
        Primary persona
      </label>
      <select
        id="agent-persona-select"
        className={styles.input}
        value={primaryPersonaId}
        onChange={(e) => setPrimaryPersonaId(e.target.value)}
        data-testid="agent-persona-select"
      >
        <option value="">(none)</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <div className={styles.actions}>
        <Button variant="ghost" type="button" onClick={onCancel} data-testid="agent-cancel">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!canSubmit} data-testid="agent-submit">
          Create Agent
        </Button>
      </div>
    </form>
  );
}

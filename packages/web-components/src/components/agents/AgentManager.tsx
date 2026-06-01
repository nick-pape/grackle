/**
 * AgentManager — presentational create form and read-only detail view for
 * standing agents (#1417, Phase 0). Pure: it takes data plus callbacks and
 * never touches the router or `useGrackle`.
 *
 * @module
 */

import { useState, type FormEvent, type JSX } from "react";
import type { AgentData, Environment, PersonaData } from "../../hooks/types.js";
import { Button } from "../display/Button.js";
import styles from "./AgentManager.module.scss";

/** Props for {@link AgentManager}. */
export interface AgentManagerProps {
  /** All agents (used to resolve the one named by `agentId` in view mode). */
  agents: AgentData[];
  /** Personas available to be chosen as the primary persona. */
  personas: PersonaData[];
  /**
   * Environments available as the Agent's home (#1418). Required in the
   * create form; rendered as a chip in the read-only view.
   */
  environments: Environment[];
  /** When set and found in `agents`, render the read-only view; else create form. */
  agentId?: string;
  /**
   * True while the parent's agent list is still loading. Suppresses the
   * not-found view while a route-matched `agentId` may still arrive, so the
   * user never briefly sees "Agent not found" between mount and first fetch.
   */
  agentsLoading?: boolean;
  /** Create a new agent. Called only in create mode. */
  onCreate: (name: string, avatar: string, primaryPersonaId: string, environmentId: string) => void;
  /** Delete the viewed agent. Called only in view mode. */
  onDelete: (id: string) => void;
  /** Navigate away (after create/delete, or via the back affordance). */
  onNavigateBack: () => void;
}

/**
 * Allowed `data:` URI subtypes for inline avatars. Excludes `svg+xml`, which
 * can embed `<script>`/event-handler payloads — modern browsers don't execute
 * scripts inside SVGs rendered via `<img>`, but CodeQL flags the flow anyway
 * (`js/xss-through-dom`), and there's no real UX cost to dropping SVG support
 * for a paste-an-image-string avatar field.
 */
const SAFE_DATA_IMAGE_PREFIXES: readonly string[] = [
  "data:image/png;",
  "data:image/jpeg;",
  "data:image/gif;",
  "data:image/webp;",
];

/**
 * True when the avatar string points to a renderable image source. Allows
 * `http(s)://`, root-relative paths, and a fixed allow-list of safe `data:`
 * image MIME types; anything else (other `data:` schemes, `javascript:`,
 * `vbscript:`, etc.) falls through to the inline-glyph branch instead of
 * becoming an `<img src>`. See CodeQL alerts #26 and #27.
 */
export function isImageAvatar(avatar: string): boolean {
  if (
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    (avatar.startsWith("/") && !avatar.startsWith("//"))
  ) {
    return true;
  }
  return SAFE_DATA_IMAGE_PREFIXES.some((p) => avatar.startsWith(p));
}

/** Render an agent's avatar: image, emoji glyph, or a name-derived monogram. */
function AvatarPreview({ name, avatar }: { name: string; avatar: string }): JSX.Element {
  if (avatar && isImageAvatar(avatar)) {
    return (
      <img
        className={styles.avatar}
        src={avatar}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        data-testid="agent-avatar-image"
      />
    );
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
  environments,
  agentId,
  agentsLoading = false,
  onCreate,
  onDelete,
  onNavigateBack,
}: AgentManagerProps): JSX.Element {
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;

  // ── Loading view ────────────────────────────────────────────────────────
  // Suppress the not-found / create branches while the parent's agent list is
  // still loading, so the user never sees a "not found" flash before the
  // matching agent arrives.
  if (agentId && !agent && agentsLoading) {
    return (
      <div className={styles.container} data-testid="agent-loading">
        <p className={styles.placeholder}>Loading…</p>
      </div>
    );
  }

  // ── Not-found view ───────────────────────────────────────────────────────
  // If the route names an `agentId` but it doesn't exist (deleted, bad URL),
  // show an explicit not-found state instead of falling through to the create
  // form — otherwise the URL `/agents/:gone` looks identical to `/agents/new`.
  if (agentId && !agent) {
    return (
      <div className={styles.container} data-testid="agent-not-found">
        <h1 className={styles.title}>Agent not found</h1>
        <p className={styles.placeholder}>
          No agent exists with id <code>{agentId}</code>.
        </p>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onNavigateBack} data-testid="agent-back">
            Back
          </Button>
        </div>
      </div>
    );
  }

  // ── Read-only view ───────────────────────────────────────────────────────
  if (agentId && agent) {
    const persona = personas.find((p) => p.id === agent.primaryPersonaId);
    const env = environments.find((e) => e.id === agent.environmentId);
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
          <dt>Environment</dt>
          <dd data-testid="agent-environment">{env ? env.displayName : agent.environmentId}</dd>
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
  return (
    <AgentCreateForm
      personas={personas}
      environments={environments}
      onCreate={onCreate}
      onCancel={onNavigateBack}
    />
  );
}

/** Props for the internal create form. */
interface AgentCreateFormProps {
  personas: PersonaData[];
  environments: Environment[];
  onCreate: (name: string, avatar: string, primaryPersonaId: string, environmentId: string) => void;
  onCancel: () => void;
}

/** Controlled create form for a new agent. */
function AgentCreateForm({
  personas,
  environments,
  onCreate,
  onCancel,
}: AgentCreateFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [primaryPersonaId, setPrimaryPersonaId] = useState("");
  // Default to the first environment so the form is submittable on first
  // glance; user can change it. If there are no environments the form's
  // submit button stays disabled (we can't create an agent without a home).
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");

  const canSubmit = name.trim().length > 0 && environmentId.length > 0;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) {
      return;
    }
    onCreate(name.trim(), avatar.trim(), primaryPersonaId, environmentId);
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

      <label className={styles.label} htmlFor="agent-environment-select">
        Environment <span className={styles.hint}>(where the agent lives)</span>
      </label>
      <select
        id="agent-environment-select"
        className={styles.input}
        value={environmentId}
        onChange={(e) => setEnvironmentId(e.target.value)}
        data-testid="agent-environment-select"
        required
      >
        {environments.length === 0 && (
          <option value="">(no environments — create one first)</option>
        )}
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.displayName}
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

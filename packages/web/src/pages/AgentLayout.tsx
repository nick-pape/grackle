/**
 * AgentLayout — layout route component for `/agents/:agentId/*` (#1419).
 * Renders the shared {@link ContextDetailShell} with agent-specific
 * avatar, name, heartbeat, and tabs, and passes agent context to child
 * routes via React Router's outlet context.
 *
 * @module
 */

import { useMemo } from "react";
import { Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import {
  ContextDetailShell,
  AGENT_DETAIL_TABS,
  isImageAvatar,
  useAppNavigate,
  agentUrl,
  formatCountdown,
  formatRelativeTime,
  type AgentTab,
  type AgentData,
} from "@grackle-ai/web-components";
import type { JSX } from "react";
import styles from "./AgentLayout.module.scss";

/** Context passed to agent tab child routes via `<Outlet context>`. */
export interface AgentOutletContext {
  agent: AgentData;
}

/** Hook for agent tab components to access the resolved agent. */
export function useAgentContext(): AgentOutletContext {
  return useOutletContext<AgentOutletContext>();
}

/** Derive the active agent tab from the URL pathname suffix. */
function deriveActiveTab(pathname: string): AgentTab {
  const suffix = pathname.replace(/^\/agents\/[^/]+\/?/, "");
  if (suffix.startsWith("sessions")) return "sessions";
  if (suffix.startsWith("schedules")) return "schedules";
  if (suffix.startsWith("settings")) return "settings";
  return "chat";
}

/** Render an agent avatar as a ReactNode for the shell header icon slot. */
function AgentAvatar({ name, avatar }: { name: string; avatar: string }): JSX.Element {
  if (avatar && isImageAvatar(avatar)) {
    return (
      <img
        src={avatar}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
        data-testid="agent-header-avatar-image"
      />
    );
  }
  const glyph = avatar || (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span aria-hidden="true" data-testid="agent-header-avatar-glyph">
      {glyph}
    </span>
  );
}

/** Heartbeat status indicators rendered below the agent name. */
function HeartbeatStatus({
  heartbeat,
}: {
  heartbeat: NonNullable<AgentData["heartbeat"]>;
}): JSX.Element {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}
      data-testid="agent-header-status"
    >
      {heartbeat.enabled && heartbeat.nextRunAt && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
          data-testid="agent-header-next-wake"
        >
          Next wake {formatCountdown(heartbeat.nextRunAt)}
        </span>
      )}
      {!heartbeat.enabled && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
          data-testid="agent-header-paused"
        >
          Paused
        </span>
      )}
      {heartbeat.lastRunAt && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
          data-testid="agent-header-last-activity"
        >
          Last activity {formatRelativeTime(heartbeat.lastRunAt)}
        </span>
      )}
    </div>
  );
}

export function AgentLayout(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const location = useLocation();
  const navigate = useAppNavigate();
  const {
    agents: { agents, agentsLoading },
  } = useGrackle();

  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const activeTab = deriveActiveTab(location.pathname);

  const handleSelectTab = useMemo(() => {
    if (!agent) return (_id: string) => {};
    return (tabId: string) => navigate(agentUrl(agent.id, tabId as AgentTab));
  }, [agent, navigate]);

  if (agentId && !agent && agentsLoading) {
    return (
      <div className={styles.container} data-testid="agent-layout-loading">
        <p className={styles.placeholder}>Loading...</p>
      </div>
    );
  }

  if (!agentId || !agent) {
    return (
      <div className={styles.container} data-testid="agent-layout-not-found">
        <h1 className={styles.notFoundTitle}>Agent not found</h1>
        <p className={styles.placeholder}>
          No agent exists with id <code>{agentId}</code>.
        </p>
        <button className={styles.backLink} onClick={() => navigate("/")}>
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="agent-layout">
      <ContextDetailShell
        icon={<AgentAvatar name={agent.name} avatar={agent.avatar} />}
        name={agent.name}
        onNavigateBack={() => navigate("/")}
        statusContent={
          agent.heartbeat ? <HeartbeatStatus heartbeat={agent.heartbeat} /> : undefined
        }
        tabs={AGENT_DETAIL_TABS}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        ariaLabel="Agent navigation"
        headerTestId="agent-header"
        tabBarTestId="agent-tab-bar"
      />
      <div className={styles.content}>
        <Outlet context={{ agent } satisfies AgentOutletContext} />
      </div>
    </div>
  );
}

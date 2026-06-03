/**
 * AgentLayout — layout route component for `/agents/:agentId/*` (#1419).
 * Renders the agent header + tab bar and passes agent context to child
 * routes via React Router's outlet context.
 *
 * @module
 */

import { Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import {
  AgentHeader,
  AgentTabBar,
  PageHeader,
  buildAgentBreadcrumbs,
  useAppNavigate,
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

export function AgentLayout(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const location = useLocation();
  const navigate = useAppNavigate();
  const {
    agents: { agents, agentsLoading },
  } = useGrackle();

  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const activeTab = deriveActiveTab(location.pathname);

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
      <PageHeader segments={buildAgentBreadcrumbs(agent.name)} />
      <AgentHeader
        name={agent.name}
        avatar={agent.avatar}
        heartbeat={agent.heartbeat}
        onNavigateBack={() => navigate("/")}
      />
      <AgentTabBar agentId={agent.id} activeTab={activeTab} />
      <div className={styles.content}>
        <Outlet context={{ agent } satisfies AgentOutletContext} />
      </div>
    </div>
  );
}

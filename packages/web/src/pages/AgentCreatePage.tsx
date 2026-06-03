/**
 * Agent create page — the `/agents/new` route. Renders the create form
 * from {@link AgentManager} with no tabs or layout wrapper.
 *
 * @module
 */

import { useGrackle } from "../context/GrackleContext.js";
import {
  AgentManager,
  PageHeader,
  buildAgentCreateBreadcrumbs,
  agentUrl,
  HOME_URL,
  useAppNavigate,
  useToast,
} from "@grackle-ai/web-components";
import type { JSX } from "react";

export function AgentCreatePage(): JSX.Element {
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    agents: { agents, agentsLoading, createAgent },
    personas: { personas },
    environments: { environments },
  } = useGrackle();

  const handleCreate = (
    name: string,
    avatar: string,
    primaryPersonaId: string,
    environmentId: string,
  ): void => {
    createAgent(name, avatar, primaryPersonaId, environmentId).then(
      (created) => {
        navigate(agentUrl(created.id));
      },
      (_err: unknown) => {
        showToast("Failed to create agent", "error");
      },
    );
  };

  return (
    <>
      <PageHeader segments={buildAgentCreateBreadcrumbs()} backUrl={HOME_URL} />
      <AgentManager
        agents={agents}
        personas={personas}
        environments={environments}
        agentsLoading={agentsLoading}
        onCreate={handleCreate}
        onDelete={() => {}}
        onNavigateBack={() => navigate("/")}
      />
    </>
  );
}

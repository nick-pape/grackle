import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { AgentManager, agentUrl, useAppNavigate, useToast } from "@grackle-ai/web-components";
import type { JSX } from "react";

/**
 * Agent create / detail page (#1417). Renders the {@link AgentManager}
 * component wired to live agent + persona data and CRUD actions from
 * {@link useGrackle}. With no `:agentId` (the `/agents/new` route) it shows the
 * create form; with a valid id it shows the read-only detail view.
 *
 * @module
 */
export function AgentDetailPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    agents: { agents, agentsLoading, createAgent, deleteAgent },
    personas: { personas },
  } = useGrackle();

  const handleCreate = (name: string, avatar: string, primaryPersonaId: string): void => {
    createAgent(name, avatar, primaryPersonaId).then(
      (created) => {
        navigate(agentUrl(created.id));
      },
      (_err: unknown) => {
        showToast("Failed to create agent", "error");
      },
    );
  };

  const handleDelete = (id: string): void => {
    deleteAgent(id).then(
      () => {
        navigate("/");
      },
      (_err: unknown) => {
        showToast("Failed to delete agent", "error");
      },
    );
  };

  const handleBack = (): void => {
    navigate("/");
  };

  return (
    <AgentManager
      agents={agents}
      personas={personas}
      agentId={agentId}
      agentsLoading={agentsLoading}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onNavigateBack={handleBack}
    />
  );
}

import { useCallback, useEffect, useMemo, type JSX } from "react";
import { Outlet, useParams } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useSidebarSlot } from "../../hooks/useSidebarSlot.js";
import { TaskList, EnvironmentNav, FindingsNav, SettingsNav, KnowledgeNav } from "@grackle-ai/web-components";

/** Layout route wrapper that shows the TaskList in the sidebar. */
export function WithTaskSidebar(): JSX.Element {
  const { workspaces, tasks } = useGrackle();
  const sidebar = useMemo(() => <TaskList workspaces={workspaces} tasks={tasks} />, [workspaces, tasks]);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the EnvironmentNav in the sidebar. */
export function WithEnvironmentSidebar(): JSX.Element {
  const { environments } = useGrackle();
  const sidebar = useMemo(() => <EnvironmentNav environments={environments} />, [environments]);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the SettingsNav in the sidebar. */
export function WithSettingsSidebar(): JSX.Element {
  const sidebar = useMemo(() => <SettingsNav />, []);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the FindingsNav in the sidebar. */
export function WithFindingsSidebar(): JSX.Element {
  const { findings, loadFindings, loadAllFindings } = useGrackle();
  const { workspaceId, environmentId } = useParams<{ workspaceId?: string; environmentId?: string }>();

  useEffect(() => {
    if (workspaceId) {
      loadFindings(workspaceId).catch(() => {});
    } else {
      loadAllFindings().catch(() => {});
    }
  }, [workspaceId, loadFindings, loadAllFindings]);

  const sidebar = useMemo(
    () => <FindingsNav findings={findings} workspaceId={workspaceId} environmentId={environmentId} />,
    [findings, workspaceId, environmentId],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the KnowledgeNav in the sidebar. */
export function WithKnowledgeSidebar(): JSX.Element {
  const { knowledge, workspaces } = useGrackle();

  const handleSearch = useCallback((query: string) => {
    knowledge.search(query).catch(() => {});
  }, [knowledge]);

  const handleClearSearch = useCallback(() => {
    knowledge.clearSearch();
  }, [knowledge]);

  const handleSelectNode = useCallback((nodeId: string) => {
    knowledge.selectNode(nodeId).catch(() => {});
  }, [knowledge]);

  const handleWorkspaceChange = useCallback((wsId: string) => {
    knowledge.loadRecent(wsId || undefined).catch(() => {});
  }, [knowledge]);

  const sidebar = useMemo(() => (
    <KnowledgeNav
      nodes={knowledge.graphData.nodes}
      workspaces={workspaces}
      loading={knowledge.loading}
      searchQuery={knowledge.searchQuery}
      onSearch={handleSearch}
      onClearSearch={handleClearSearch}
      onSelectNode={handleSelectNode}
      onWorkspaceChange={handleWorkspaceChange}
    />
  ), [knowledge, workspaces, handleSearch, handleClearSearch, handleSelectNode, handleWorkspaceChange]);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

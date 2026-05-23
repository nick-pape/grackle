import { useCallback, useMemo, type JSX } from "react";
import { Outlet } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useSidebarSlot } from "../../hooks/useSidebarSlot.js";
import { TaskList, EnvironmentNav, SettingsNav, KnowledgeNav, StreamList } from "@grackle-ai/web-components";

/** Layout route wrapper that shows the TaskList in the sidebar. */
export function WithTaskSidebar(): JSX.Element {
  const { workspaces: { workspaces }, tasks: { tasks } } = useGrackle();
  const sidebar = useMemo(() => <TaskList workspaces={workspaces} tasks={tasks} />, [workspaces, tasks]);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the EnvironmentNav in the sidebar. */
export function WithEnvironmentSidebar(): JSX.Element {
  const { environments: { environments } } = useGrackle();
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

/** Layout route wrapper that shows the KnowledgeNav in the sidebar. */
export function WithKnowledgeSidebar(): JSX.Element {
  const { knowledge, workspaces: { workspaces } } = useGrackle();

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

/** Layout route wrapper that shows the StreamList in the sidebar. */
export function WithStreamSidebar(): JSX.Element {
  const { streams: { streams, streamsLoading, streamsLoadError, streamsLoadedOnce, loadStreams } } = useGrackle();
  const handleRefresh = useCallback(() => { loadStreams().catch(() => {}); }, [loadStreams]);
  const sidebar = useMemo(
    () => (
      <StreamList
        streams={streams}
        loading={streamsLoading}
        streamsLoadError={streamsLoadError}
        streamsLoadedOnce={streamsLoadedOnce}
        onRefresh={handleRefresh}
      />
    ),
    [streams, streamsLoading, streamsLoadError, streamsLoadedOnce, handleRefresh],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

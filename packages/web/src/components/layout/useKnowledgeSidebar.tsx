import { useCallback, useMemo, type ReactNode } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { KnowledgeNav } from "@grackle-ai/web-components";

/**
 * Builds the memoised KnowledgeNav sidebar element for WithKnowledgeSidebar.
 * Calls useGrackle() — must only be used from layout/route components or pages.
 *
 * @returns A stable ReactNode to pass to useSidebarSlot.
 */
export function useKnowledgeSidebar(): ReactNode {
  const {
    knowledge,
    workspaces: { workspaces },
  } = useGrackle();

  const handleSearch = useCallback(
    (query: string) => {
      knowledge.search(query).catch(() => {});
    },
    [knowledge],
  );

  const handleClearSearch = useCallback(() => {
    knowledge.clearSearch();
  }, [knowledge]);

  const handleSelectNode = useCallback(
    (nodeId: string) => {
      knowledge.selectNode(nodeId).catch(() => {});
    },
    [knowledge],
  );

  const handleWorkspaceChange = useCallback(
    (wsId: string) => {
      knowledge.loadRecent(wsId || undefined).catch(() => {});
    },
    [knowledge],
  );

  return useMemo(
    () => (
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
    ),
    [
      knowledge,
      workspaces,
      handleSearch,
      handleClearSearch,
      handleSelectNode,
      handleWorkspaceChange,
    ],
  );
}

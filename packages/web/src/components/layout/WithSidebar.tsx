import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Outlet } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useSidebarSlot } from "../../hooks/useSidebarSlot.js";
import {
  TaskList,
  EnvironmentNav,
  SettingsNav,
  KnowledgeNav,
  PersonaNav,
  ScheduleNav,
  CoordinationList,
  useThemeContext,
} from "@grackle-ai/web-components";
import type { StreamData } from "@grackle-ai/web-components";

/** Layout route wrapper that shows the TaskList in the sidebar. */
export function WithTaskSidebar(): JSX.Element {
  const {
    workspaces: { workspaces },
    tasks: { tasks },
  } = useGrackle();
  const sidebar = useMemo(
    () => <TaskList workspaces={workspaces} tasks={tasks} />,
    [workspaces, tasks],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the EnvironmentNav in the sidebar. */
export function WithEnvironmentSidebar(): JSX.Element {
  const {
    environments: { environments },
  } = useGrackle();
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

  const sidebar = useMemo(
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
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the PersonaNav in the sidebar. */
export function WithPersonaSidebar(): JSX.Element {
  const {
    personas: { personas },
    appDefaultPersonaId,
  } = useGrackle();
  const sidebar = useMemo(
    () => <PersonaNav personas={personas} appDefaultPersonaId={appDefaultPersonaId} />,
    [personas, appDefaultPersonaId],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the ScheduleNav in the sidebar. */
export function WithScheduleSidebar(): JSX.Element {
  const {
    schedules: { schedules },
    personas: { personas },
  } = useGrackle();
  const sidebar = useMemo(
    () => <ScheduleNav schedules={schedules} personas={personas} />,
    [schedules, personas],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Context passed to CoordinationPage via outlet context. */
export interface CoordinationOutletContext {
  /** Currently selected stream, if any. */
  selectedStream: StreamData | undefined;
  /** Currently selected stream ID. */
  selectedStreamId: string | undefined;
  /** Set the selected stream ID. */
  setSelectedStreamId: (id: string | undefined) => void;
  /** Whether a transcript is currently loading. */
  transcriptLoading: boolean;
  /** Resolved theme ID for graph rendering. */
  resolvedThemeId: string;
}

/** Layout route wrapper that shows the CoordinationList in the sidebar. */
export function WithCoordinationSidebar(): JSX.Element {
  const {
    streams: {
      streams,
      streamsLoading,
      streamsLoadedOnce,
      streamsLoadError,
      loadStreams,
      loadTranscript,
    },
    sessions: { sessions },
    tasks: { tasks },
  } = useGrackle();

  const [showInternals, setShowInternals] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(undefined);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    if (selectedStreamId === undefined) {
      setTranscriptLoading(false);
      return;
    }
    let active = true;
    setTranscriptLoading(true);
    loadTranscript(selectedStreamId)
      .then(() => {
        if (active) {
          setTranscriptLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setTranscriptLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedStreamId, loadTranscript]);

  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    loadStreams(showInternals).catch(() => {});
  }, [showInternals, loadStreams]);

  const handleRefresh = useCallback(() => {
    loadStreams(showInternals).catch(() => {});
  }, [loadStreams, showInternals]);

  const selectedStream =
    selectedStreamId !== undefined ? streams.find((s) => s.id === selectedStreamId) : undefined;

  const sidebar = useMemo(
    () => (
      <CoordinationList
        streams={streams}
        sessions={sessions}
        tasks={tasks}
        loading={streamsLoading}
        loadError={streamsLoadError}
        loadedOnce={streamsLoadedOnce}
        showInternals={showInternals}
        onToggleInternals={setShowInternals}
        selectedStreamId={selectedStreamId}
        onSelectStream={setSelectedStreamId}
        onRefresh={handleRefresh}
      />
    ),
    [
      streams,
      sessions,
      tasks,
      streamsLoading,
      streamsLoadError,
      streamsLoadedOnce,
      showInternals,
      selectedStreamId,
      handleRefresh,
    ],
  );
  useSidebarSlot(sidebar);

  const { resolvedThemeId } = useThemeContext();

  const outletContext = useMemo<CoordinationOutletContext>(
    () => ({
      selectedStream,
      selectedStreamId,
      setSelectedStreamId,
      transcriptLoading,
      resolvedThemeId,
    }),
    [selectedStream, selectedStreamId, transcriptLoading, resolvedThemeId],
  );

  return <Outlet context={outletContext} />;
}

import { useMemo, type JSX } from "react";
import { Outlet } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useSidebarSlot } from "../../hooks/useSidebarSlot.js";
import {
  TaskList,
  EnvironmentNav,
  SettingsNav,
  PersonaNav,
  ScheduleNav,
} from "@grackle-ai/web-components";
import { useKnowledgeSidebar } from "./useKnowledgeSidebar.js";
import { useCoordinationSidebar } from "./useCoordinationSidebar.js";

// Re-export so existing consumers (CoordinationPage) can keep their import path.
export type { CoordinationOutletContext } from "./useCoordinationSidebar.js";

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
  const sidebar = useKnowledgeSidebar();
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
    workspaces: { workspaces },
  } = useGrackle();
  const sidebar = useMemo(
    () => <ScheduleNav schedules={schedules} personas={personas} workspaces={workspaces} />,
    [schedules, personas, workspaces],
  );
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the CoordinationList in the sidebar. */
export function WithCoordinationSidebar(): JSX.Element {
  const { sidebar, outletContext } = useCoordinationSidebar();
  useSidebarSlot(sidebar);
  return <Outlet context={outletContext} />;
}

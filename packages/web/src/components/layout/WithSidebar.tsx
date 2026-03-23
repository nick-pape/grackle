import { useMemo, type JSX } from "react";
import { Outlet } from "react-router";
import { useSidebarSlot } from "../../hooks/useSidebarSlot.js";
import { TaskList } from "../lists/TaskList.js";
import { EnvironmentNav } from "../lists/EnvironmentNav.js";
import { SettingsNav } from "../settings/SettingsNav.js";
import { KnowledgeNav } from "../knowledge/KnowledgeNav.js";

/** Layout route wrapper that shows the TaskList in the sidebar. */
export function WithTaskSidebar(): JSX.Element {
  const sidebar = useMemo(() => <TaskList />, []);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

/** Layout route wrapper that shows the EnvironmentNav in the sidebar. */
export function WithEnvironmentSidebar(): JSX.Element {
  const sidebar = useMemo(() => <EnvironmentNav />, []);
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
  const sidebar = useMemo(() => <KnowledgeNav />, []);
  useSidebarSlot(sidebar);
  return <Outlet />;
}

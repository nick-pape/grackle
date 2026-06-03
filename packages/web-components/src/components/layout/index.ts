/**
 * Layout components for the application shell structure.
 * @module layout
 */
export { StatusBar } from "./StatusBar.js";
export { AppNav, TABS, getActiveView } from "./AppNav.js";
export type { AppTab, AppNavProps, AppView, NavGroup } from "./AppNav.js";
export { ContextNav, CONTEXTS, DEFAULT_CONTEXT_ID } from "./ContextNav.js";
export type { ContextItem, ContextNavProps } from "./ContextNav.js";
export { ContextDetailShell, CODE_HEADER_ICON, AGENT_DETAIL_TABS } from "./ContextDetailShell.js";
export type { ContextDetailShellProps, ContextDetailTab } from "./ContextDetailShell.js";
export { Sidebar } from "./Sidebar.js";
export { BottomStatusBar } from "./BottomStatusBar.js";

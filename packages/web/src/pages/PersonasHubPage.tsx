import { type JSX } from "react";
import { Outlet } from "react-router";
import { PageHeader, buildPersonaLibraryBreadcrumbs, HOME_URL } from "@grackle-ai/web-components";

/** Personas hub page with breadcrumbs, back-navigation, and routed content area. */
export function PersonasHubPage(): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageHeader segments={buildPersonaLibraryBreadcrumbs()} backUrl={HOME_URL} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <Outlet />
      </div>
    </div>
  );
}

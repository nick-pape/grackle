/**
 * Findings list page — displays all findings with optional workspace scoping.
 *
 * @module
 */

import { useEffect, useCallback, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import {
  Breadcrumbs, FindingsPanel,
  buildFindingsBreadcrumbs, buildFindingBreadcrumbs,
  findingUrl, useAppNavigate,
} from "@grackle-ai/web-components";
import { FindingsListShimmer } from "./FindingsListShimmer.js";
import styles from "./FindingsListPage.module.scss";

/** Findings list page with optional workspace scoping. */
export function FindingsListPage(): JSX.Element {
  const { environmentId, workspaceId } = useParams<{
    environmentId?: string;
    workspaceId?: string;
  }>();
  const { findings, loadFindings, workspaces, environments, findingsLoading } = useGrackle();
  const navigate = useAppNavigate();

  useEffect(() => {
    if (workspaceId) {
      loadFindings(workspaceId).catch(() => {});
    }
    // Global findings are loaded by WithFindingsSidebar; only load here for workspace-scoped routes.
  }, [workspaceId, loadFindings]);

  const handleFindingClick = useCallback((findingId: string) => {
    navigate(findingUrl(findingId, workspaceId, environmentId));
  }, [navigate, workspaceId, environmentId]);

  if (findingsLoading) {
    return <FindingsListShimmer />;
  }

  const breadcrumbs = (workspaceId && environmentId)
    ? buildFindingBreadcrumbs("Findings", workspaceId, environmentId, workspaces, environments).slice(0, -1)
    : buildFindingsBreadcrumbs();

  return (
    <div className={styles.container} data-testid="findings-list-page">
      <Breadcrumbs segments={breadcrumbs} />
      <h1 className={styles.title}>Findings</h1>
      <FindingsPanel findings={findings} onFindingClick={handleFindingClick} />
    </div>
  );
}

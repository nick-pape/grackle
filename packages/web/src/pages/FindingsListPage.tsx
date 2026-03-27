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
  buildFindingsBreadcrumbs,
  findingUrl, useAppNavigate,
} from "@grackle-ai/web-components";
import styles from "./FindingsListPage.module.scss";

/** Findings list page with optional workspace scoping. */
export function FindingsListPage(): JSX.Element {
  const { environmentId, workspaceId } = useParams<{
    environmentId?: string;
    workspaceId?: string;
  }>();
  const { findings, loadFindings, loadAllFindings } = useGrackle();
  const navigate = useAppNavigate();

  useEffect(() => {
    if (workspaceId) {
      loadFindings(workspaceId);
    } else {
      loadAllFindings();
    }
  }, [workspaceId, loadFindings, loadAllFindings]);

  const handleFindingClick = useCallback((findingId: string) => {
    navigate(findingUrl(findingId, workspaceId, environmentId));
  }, [navigate, workspaceId, environmentId]);

  const breadcrumbs = buildFindingsBreadcrumbs();

  return (
    <div className={styles.container} data-testid="findings-list-page">
      <Breadcrumbs segments={breadcrumbs} />
      <h1 className={styles.title}>Findings</h1>
      <FindingsPanel findings={findings} onFindingClick={handleFindingClick} />
    </div>
  );
}

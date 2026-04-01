import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { AboutPanel, UpdateBanner } from "@grackle-ai/web-components";
import { useVersionStatus } from "../../hooks/useVersionStatus.js";

/** Settings tab wrapping the about panel. */
export function SettingsAboutTab(): JSX.Element {
  const { connectionStatus, environments: { environments }, sessions: { sessions } } = useGrackle();
  const versionStatus = useVersionStatus();

  return (
    <>
      {versionStatus && (
        <UpdateBanner
          currentVersion={versionStatus.currentVersion}
          latestVersion={versionStatus.latestVersion}
          updateAvailable={versionStatus.updateAvailable}
          isDocker={versionStatus.isDocker}
        />
      )}
      <AboutPanel connectionStatus={connectionStatus} environments={environments} sessions={sessions} />
    </>
  );
}

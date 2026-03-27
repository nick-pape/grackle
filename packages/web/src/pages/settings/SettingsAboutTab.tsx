import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { AboutPanel } from "@grackle-ai/web-components";
import { UpdateBanner } from "@grackle-ai/web-components";
import { useVersionStatus } from "../../hooks/useVersionStatus.js";

/** Settings tab wrapping the about panel. */
export function SettingsAboutTab(): JSX.Element {
  const { connected, environments, sessions } = useGrackle();
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
      <AboutPanel connected={connected} environments={environments} sessions={sessions} />
    </>
  );
}

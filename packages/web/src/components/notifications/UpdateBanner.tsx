import type { JSX } from "react";
import { Callout } from "./Callout.js";

/** Props for the UpdateBanner component. */
interface UpdateBannerProps {
  /** The currently running Grackle version. */
  currentVersion: string;
  /** The latest version available on npm. */
  latestVersion: string;
  /** Whether an update is available. */
  updateAvailable: boolean;
  /** Whether the server is running in a Docker container. */
  isDocker: boolean;
}

/**
 * Dismissible info banner shown when a newer Grackle version is available.
 *
 * Renders nothing when `updateAvailable` is false. Shows context-appropriate
 * upgrade instructions for Docker vs npm users.
 */
export function UpdateBanner({
  currentVersion,
  latestVersion,
  updateAvailable,
  isDocker,
}: UpdateBannerProps): JSX.Element | undefined {
  if (!updateAvailable) {
    return undefined;
  }

  const command = isDocker
    ? `docker pull ghcr.io/nick-pape/grackle:latest`
    : `npm install -g @grackle-ai/cli@${latestVersion}`;

  return (
    <div data-testid="update-banner">
      <Callout variant="info" dismissible>
        <strong>Grackle v{latestVersion}</strong> is available (you have v{currentVersion}).
        {" "}Run: <code>{command}</code>
      </Callout>
    </div>
  );
}

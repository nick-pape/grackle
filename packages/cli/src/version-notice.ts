/**
 * CLI version update notice — formats a one-line update message for terminal output.
 *
 * @module
 */

import chalk from "chalk";
import type { VersionStatus } from "@grackle-ai/core";

/**
 * Format a version update notice for CLI output.
 *
 * @returns A styled string if an update is available, or `""` if current.
 */
export function formatVersionNotice(status: VersionStatus): string {
  if (!status.updateAvailable) {
    return "";
  }

  const command = status.isDocker
    ? `docker pull ghcr.io/nick-pape/grackle:latest`
    : `npm install -g @grackle-ai/cli@${status.latestVersion}`;

  return chalk.yellow(
    `\u26A0 Update available: ${status.currentVersion} \u2192 ${status.latestVersion}. Run: ${command}`,
  );
}

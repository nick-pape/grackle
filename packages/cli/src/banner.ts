import chalk from "chalk";

const GITHUB_URL: string = "https://github.com/nick-pape/grackle";

/**
 * Returns the Grackle CLI banner string with ASCII art bird, version, and GitHub link.
 */
export function renderBanner(version: string): string {
  const purple = chalk.hex("#8b5cf6");
  const yellow = chalk.hex("#eab308");
  const gray = chalk.hex("#9ca3af");
  const dim = chalk.dim;

  const bird: string = [
    `    ${gray("_")}`,
    `   ${gray("(")}${yellow("o")}${gray(">")}`,
    `  ${purple("//")}${gray("\\\\")}`,
    `  ${purple("V_/_")}`,
  ].join("\n");

  return [
    "",
    bird + `    ${chalk.bold.hex("#8b5cf6")("G R A C K L E")}`,
    `         ${dim(`v${version}`)}`,
    `         ${dim(GITHUB_URL)}`,
    "",
  ].join("\n");
}

/**
 * Returns the help footer with a link to the GitHub repo.
 */
export function getHelpFooter(): string {
  return `\n  Docs & issues: ${GITHUB_URL}\n`;
}

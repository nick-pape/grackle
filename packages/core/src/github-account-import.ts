/**
 * Auto-imports GitHub accounts from the local `gh` CLI authentication state.
 *
 * On server startup (and via the `ImportGitHubAccounts` RPC), this module reads
 * all accounts from `gh auth status --json hosts`, resolves their tokens via
 * `gh auth token`, and registers them in the `github_accounts` database table —
 * skipping any account whose username is already stored.
 */
import { githubAccountStore } from "@grackle-ai/database";
import { exec } from "./utils/exec.js";
import { logger } from "./logger.js";

/** Timeout for `gh auth status` in milliseconds. */
const GH_AUTH_STATUS_TIMEOUT_MS: number = 10_000;

/** Timeout for `gh auth token` per account in milliseconds. */
const GH_AUTH_TOKEN_TIMEOUT_MS: number = 5_000;

/** Shape of a single account entry from `gh auth status --json hosts`. */
interface GhAuthAccount {
  state: string;
  active: boolean;
  host: string;
  login: string;
  tokenSource: string;
}

/**
 * Build a human-readable label for an imported account.
 * For github.com accounts the label is just the login. For GHES/other hosts
 * the host is appended so labels remain unique and identifiable.
 */
function buildImportLabel(login: string, host: string): string {
  return host === "github.com" ? login : `${login}@${host}`;
}

/** Shape of the `gh auth status --json hosts` output. */
interface GhAuthStatusOutput {
  hosts: Record<string, GhAuthAccount[]>;
}

/** Result of a bulk import operation. */
export interface ImportAccountsResult {
  imported: number;
  usernames: string[];
}

/**
 * Import GitHub accounts from the local `gh` CLI authentication state.
 *
 * Reads all logged-in accounts from `gh auth status --json hosts`, then for
 * each account whose username is not already stored, resolves its token via
 * `gh auth token --user <login>` and inserts a new `github_accounts` row.
 * The active account is marked as the default if no default exists yet.
 *
 * Returns an empty result (0 imported) if `gh` is unavailable or not logged in.
 */
export async function importAccountsFromGhCli(): Promise<ImportAccountsResult> {
  let statusOutput: GhAuthStatusOutput;
  try {
    const result = await exec(
      "gh",
      ["auth", "status", "--json", "hosts"],
      { timeout: GH_AUTH_STATUS_TIMEOUT_MS },
    );
    statusOutput = JSON.parse(result.stdout) as GhAuthStatusOutput;
  } catch {
    // gh CLI not installed, not logged in, or command failed — silently skip
    return { imported: 0, usernames: [] };
  }

  const imported: string[] = [];
  // Track whether any default has been assigned — either pre-existing or during this pass.
  let defaultAssigned = githubAccountStore.getDefaultGitHubAccount() !== undefined;

  for (const [host, accounts] of Object.entries(statusOutput.hosts)) {
    for (const account of accounts) {
      if (!account.login) {
        continue;
      }

      // Use a host-qualified label to disambiguate same-login across multiple hosts.
      const label = buildImportLabel(account.login, host);

      // Skip if already registered (match by label to handle host-qualified identities).
      const existing = githubAccountStore.findGitHubAccountByLabel(label);
      if (existing) {
        continue;
      }

      // Resolve the token for this account, passing --hostname so `gh` selects
      // the correct credential when multiple hosts are configured.
      let token: string;
      try {
        const tokenResult = await exec(
          "gh",
          ["auth", "token", "--user", account.login, "--hostname", host],
          { timeout: GH_AUTH_TOKEN_TIMEOUT_MS },
        );
        token = tokenResult.stdout.trim();
      } catch {
        logger.warn({ username: account.login, host }, "Could not resolve gh auth token for account; skipping");
        continue;
      }

      if (!token) {
        continue;
      }

      // Mark the first active account as default only if no default exists yet in this pass.
      const isDefault = account.active && !defaultAssigned;

      try {
        githubAccountStore.addGitHubAccount(label, account.login, token, isDefault);
        if (isDefault) {
          defaultAssigned = true;
        }
        imported.push(account.login);
        logger.info({ username: account.login, host, label, isDefault }, "Imported GitHub account from gh CLI");
      } catch {
        logger.warn(
          { username: account.login, host, label },
          "Could not import GitHub account from gh CLI; skipping",
        );
      }
    }
  }

  return { imported: imported.length, usernames: imported };
}

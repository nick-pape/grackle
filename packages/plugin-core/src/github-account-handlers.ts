/**
 * gRPC handler implementations for GitHub account management.
 *
 * These handlers expose the github_accounts database table over the
 * GrackleCore service, allowing clients to register multiple GitHub identities
 * and associate them with environments.
 */
import { create } from "@bufbuild/protobuf";
import { grackle, ConflictError, PreconditionError } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import type { GitHubAccountInfo, UpdateGitHubAccountFields } from "@grackle-ai/database";
import { exec } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { requireGitHubAccount, requireNonEmpty, requireTrimmed } from "./require-helpers.js";

/** Timeout when resolving a username from the GitHub API. */
const GH_API_TIMEOUT_MS: number = 10_000;

/**
 * Resolve the GitHub username for a token by calling the GitHub API.
 * Returns an empty string if the API call fails.
 */
async function resolveGitHubUsername(token: string): Promise<string> {
  try {
    const result = await exec("gh", ["api", "user", "--jq", ".login"], {
      timeout: GH_API_TIMEOUT_MS,
      env: { ...process.env, GH_TOKEN: token },
    });
    return result.stdout.trim();
  } catch (err) {
    logger.warn({ err }, "Failed to resolve GitHub username from token");
    return "";
  }
}

/** Convert a GitHubAccountInfo record to its proto representation. */
function accountToProto(info: GitHubAccountInfo): grackle.GitHubAccount {
  return create(grackle.GitHubAccountSchema, {
    id: info.id,
    label: info.label,
    username: info.username,
    isDefault: info.isDefault,
    createdAt: info.createdAt,
  });
}

/** List all registered GitHub accounts (tokens are never returned). */
export async function listGitHubAccounts(): Promise<grackle.GitHubAccountList> {
  const { githubAccountStore } = getDatabaseStores();
  const accounts = githubAccountStore.listGitHubAccounts();
  return create(grackle.GitHubAccountListSchema, {
    accounts: accounts.map(accountToProto),
  });
}

/** Register a new GitHub account. Resolves the GitHub username if not provided. */
export async function addGitHubAccount(
  req: grackle.AddGitHubAccountRequest,
): Promise<grackle.GitHubAccount> {
  const { githubAccountStore } = getDatabaseStores();
  requireTrimmed(req.label, "label");
  const token = requireTrimmed(req.token, "token");
  let { username } = req;
  if (!username.trim()) {
    username = await resolveGitHubUsername(token);
  }

  let id: string;
  try {
    id = githubAccountStore.addGitHubAccount(req.label.trim(), username, token, req.isDefault);
  } catch (err) {
    // Translate SQLite UNIQUE constraint violation into a user-facing gRPC error.
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new ConflictError(`A GitHub account with label "${req.label.trim()}" already exists`);
    }
    throw err;
  }

  logger.info({ id, label: req.label, username }, "GitHub account added");
  emit("github_account.changed", {});

  const account = githubAccountStore.listGitHubAccounts().find((a) => a.id === id);
  if (!account) {
    throw new PreconditionError("Account was created but could not be retrieved", { id });
  }
  return accountToProto(account);
}

/** Update a registered GitHub account (label, token, or default status). */
export async function updateGitHubAccount(
  req: grackle.UpdateGitHubAccountRequest,
): Promise<grackle.GitHubAccount> {
  const { githubAccountStore } = getDatabaseStores();
  const existing = requireGitHubAccount(req.id);

  const fields: UpdateGitHubAccountFields = {};
  if (req.label !== undefined) {
    fields.label = requireNonEmpty(req.label, "label");
  }
  if (req.token !== undefined) {
    const trimmedToken = requireNonEmpty(req.token, "token");
    fields.token = trimmedToken;
    // Re-resolve username when token changes
    fields.username = await resolveGitHubUsername(trimmedToken);
  }
  if (req.isDefault !== undefined) {
    fields.isDefault = req.isDefault;
  }

  githubAccountStore.updateGitHubAccount(req.id, fields);
  logger.info({ id: req.id }, "GitHub account updated");
  emit("github_account.changed", {});

  const updated = githubAccountStore.getGitHubAccount(req.id);
  return accountToProto(updated!);
}

/** Remove a registered GitHub account. */
export async function removeGitHubAccount(
  req: grackle.RemoveGitHubAccountRequest,
): Promise<grackle.Empty> {
  const { githubAccountStore } = getDatabaseStores();
  const existing = requireGitHubAccount(req.id);

  githubAccountStore.removeGitHubAccount(req.id);
  logger.info({ id: req.id, label: existing.label }, "GitHub account removed");
  emit("github_account.changed", {});

  return create(grackle.EmptySchema, {});
}

/**
 * Import GitHub accounts from the local `gh` CLI authentication state.
 * Skips accounts already registered (matched by username).
 */
export async function importGitHubAccounts(): Promise<grackle.ImportGitHubAccountsResponse> {
  const { importAccountsFromGhCli } = await import("@grackle-ai/core");
  const result = await importAccountsFromGhCli();
  if (result.imported > 0) {
    emit("github_account.changed", {});
  }
  return create(grackle.ImportGitHubAccountsResponseSchema, {
    imported: result.imported,
    usernames: result.usernames,
  });
}

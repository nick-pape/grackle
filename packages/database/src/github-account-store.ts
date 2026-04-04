/**
 * Persistence layer for GitHub account credentials.
 *
 * Each account stores an encrypted PAT, a human-readable label, and a GitHub
 * username. One account can be marked as the default, used when an environment
 * does not specify an explicit `github_account_id`.
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import db from "./db.js";
import { githubAccounts, type GitHubAccountRow } from "./schema.js";
import { encrypt, decrypt } from "./crypto.js";

export type { GitHubAccountRow };

/** A GitHub account record as returned to callers (token is never exposed). */
export interface GitHubAccountInfo {
  id: string;
  label: string;
  username: string;
  isDefault: boolean;
  createdAt: string;
}

/** Fields that can be updated on an existing GitHub account. */
export interface UpdateGitHubAccountFields {
  label?: string;
  username?: string;
  token?: string;
  isDefault?: boolean;
}

/**
 * Add a new GitHub account with an encrypted token.
 * Returns the generated account ID.
 */
export function addGitHubAccount(
  label: string,
  username: string,
  token: string,
  isDefault: boolean = false,
): string {
  const id = randomUUID();
  if (isDefault) {
    // Clear any existing default before setting the new one.
    db.update(githubAccounts).set({ isDefault: false }).run();
  }
  db.insert(githubAccounts)
    .values({
      id,
      label,
      username,
      token: encrypt(token),
      isDefault,
    })
    .run();
  return id;
}

/**
 * Retrieve a single GitHub account by ID.
 * The returned token is decrypted.
 */
export function getGitHubAccount(id: string): (GitHubAccountInfo & { token: string }) | undefined {
  const row = db.select().from(githubAccounts).where(eq(githubAccounts.id, id)).get();
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    token: decrypt(row.token),
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}

/** Return all GitHub accounts (tokens are omitted for security). */
export function listGitHubAccounts(): GitHubAccountInfo[] {
  const rows = db.select().from(githubAccounts).all();
  return rows.map((row: GitHubAccountRow) => ({
    id: row.id,
    label: row.label,
    username: row.username,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  }));
}

/** Return the default GitHub account (token is decrypted), or undefined if none is set. */
export function getDefaultGitHubAccount(): (GitHubAccountInfo & { token: string }) | undefined {
  const rows = db.select().from(githubAccounts).all();
  const row = rows.find((r: GitHubAccountRow) => r.isDefault);
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    token: decrypt(row.token),
    isDefault: true,
    createdAt: row.createdAt,
  };
}

/** Find a GitHub account by label (case-insensitive). Returns undefined if not found. */
export function findGitHubAccountByLabel(label: string): GitHubAccountInfo | undefined {
  const rows = db.select().from(githubAccounts).all();
  const row = rows.find((r: GitHubAccountRow) => r.label.toLowerCase() === label.toLowerCase());
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}

/** Find a GitHub account by username. Returns undefined if not found. */
export function findGitHubAccountByUsername(username: string): GitHubAccountInfo | undefined {
  const rows = db.select().from(githubAccounts).all();
  const row = rows.find((r: GitHubAccountRow) => r.username === username);
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}

/** Update mutable fields of an existing GitHub account. */
export function updateGitHubAccount(id: string, fields: UpdateGitHubAccountFields): void {
  const updates: Partial<GitHubAccountRow> = {};
  if (fields.label !== undefined) {
    updates.label = fields.label;
  }
  if (fields.username !== undefined) {
    updates.username = fields.username;
  }
  if (fields.token !== undefined) {
    updates.token = encrypt(fields.token);
  }
  if (fields.isDefault !== undefined) {
    if (fields.isDefault) {
      // Clear any existing default before setting this one.
      db.update(githubAccounts).set({ isDefault: false }).run();
    }
    updates.isDefault = fields.isDefault;
  }
  if (Object.keys(updates).length === 0) {
    return;
  }
  db.update(githubAccounts).set(updates).where(eq(githubAccounts.id, id)).run();
}

/** Remove a GitHub account by ID. */
export function removeGitHubAccount(id: string): void {
  db.delete(githubAccounts).where(eq(githubAccounts.id, id)).run();
}

/**
 * Resolve a GitHub token for the given account ID.
 *
 * Resolution order:
 * 1. The specified account's token (if `githubAccountId` is non-empty)
 * 2. The default account's token (if one exists)
 * 3. `GH_TOKEN` env var
 * 4. `GITHUB_TOKEN` env var
 * 5. `undefined` (caller should fall back to `gh auth token`)
 */
export function resolveStoredGitHubToken(githubAccountId?: string): string | undefined {
  if (githubAccountId) {
    const account = getGitHubAccount(githubAccountId);
    if (account?.token) {
      return account.token;
    }
  }

  const defaultAccount = getDefaultGitHubAccount();
  if (defaultAccount?.token) {
    return defaultAccount.token;
  }

  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined;
}

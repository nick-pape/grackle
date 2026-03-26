import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { exec } from "./utils/exec.js";
import { formatGhError } from "./utils/format-gh-error.js";
import { logger } from "./logger.js";

/** Timeout for `gh codespace list` in milliseconds. */
const GH_CODESPACE_LIST_TIMEOUT_MS: number = 30_000;

/** Timeout for `gh codespace create` in milliseconds. */
const GH_CODESPACE_CREATE_TIMEOUT_MS: number = 300_000;

/** Maximum number of codespaces returned by `gh codespace list`. */
const GH_CODESPACE_LIST_LIMIT: number = 50;

/** List available GitHub Codespaces. */
export async function listCodespaces(): Promise<grackle.CodespaceList> {
  try {
    const result = await exec(
      "gh",
      [
        "codespace",
        "list",
        "--json",
        "name,repository,state,gitStatus",
        "--limit",
        String(GH_CODESPACE_LIST_LIMIT),
      ],
      { timeout: GH_CODESPACE_LIST_TIMEOUT_MS },
    );
    const entries = JSON.parse(result.stdout || "[]") as Array<Record<string, unknown>>;
    return create(grackle.CodespaceListSchema, {
      codespaces: entries.map((e) =>
        create(grackle.CodespaceInfoSchema, {
          name: String(e.name ?? ""),
          repository: String(e.repository ?? ""),
          state: String(e.state ?? ""),
          gitStatus: String(e.gitStatus ?? ""),
        }),
      ),
    });
  } catch (err) {
    logger.warn({ err }, "Failed to list codespaces");
    return create(grackle.CodespaceListSchema, {
      codespaces: [],
      error: formatGhError(err, "list codespaces"),
    });
  }
}

/** Create a new GitHub Codespace. */
export async function createCodespace(req: grackle.CreateCodespaceRequest): Promise<grackle.CreateCodespaceResponse> {
  if (!req.repo.trim()) {
    throw new ConnectError("repo is required", Code.InvalidArgument);
  }
  const trimmedRepo = req.repo.trim();
  const createArgs = ["codespace", "create", "--repo", trimmedRepo];
  if (req.machine.trim()) {
    createArgs.push("--machine", req.machine.trim());
  }
  try {
    const result = await exec("gh", createArgs, {
      timeout: GH_CODESPACE_CREATE_TIMEOUT_MS,
    });
    return create(grackle.CreateCodespaceResponseSchema, {
      name: result.stdout.trim(),
      repository: trimmedRepo,
    });
  } catch (err) {
    logger.error({ err, repo: trimmedRepo }, "Failed to create codespace");
    throw new ConnectError(
      formatGhError(err, "create codespace"),
      Code.Internal,
    );
  }
}

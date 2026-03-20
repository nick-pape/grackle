import { writeFile as writeFileNode, mkdir as mkdirNode, realpath as realpathNode } from "node:fs/promises";
import { dirname, resolve, normalize } from "node:path";
import { homedir as homedirNode } from "node:os";
import { realpathSync as realpathSyncNode, existsSync as existsSyncNode } from "node:fs";
import { logger } from "./logger.js";

/** Abstraction over filesystem operations used by {@link writeTokens}. */
export interface FileSystem {
  realpathSync(path: string): string;
  existsSync(path: string): boolean;
  realpath(path: string): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, data: string, options: { mode: number }): Promise<void>;
  homedir(): string;
}

/** Default implementation that delegates to real Node APIs. */
const NODE_FILE_SYSTEM: FileSystem = {
  realpathSync: realpathSyncNode,
  existsSync: existsSyncNode,
  realpath: realpathNode,
  mkdir: (path, options) => mkdirNode(path, options).then(() => undefined),
  writeFile: (path, data, options) => writeFileNode(path, data, options),
  homedir: homedirNode,
};

/**
 * @internal Verify that a resolved file path is under the user's home directory,
 * accounting for symlinks and case-insensitive filesystems.
 * Exported for testing.
 */
export function isUnderHome(resolvedPath: string, home: string): boolean {
  // Normalize case for case-insensitive filesystems (Windows, macOS default)
  // Also normalize separators to forward slashes for consistent comparison
  const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, "/");
  const normalizedHome = home.toLowerCase().replace(/\\/g, "/");
  // Ensure the home prefix is followed by a separator (or is an exact match)
  // to prevent prefix-collision (e.g. /home/user vs /home/username)
  const homeWithSep = normalizedHome.endsWith("/")
    ? normalizedHome
    : normalizedHome + "/";
  return normalizedPath.startsWith(homeWithSep) || normalizedPath === normalizedHome;
}

/** Apply a batch of tokens by setting env vars or writing files under the user's home directory. */
export async function writeTokens(
  tokens: Array<{ name: string; type: string; envVar: string; filePath: string; value: string }>,
  fileSystem: FileSystem = NODE_FILE_SYSTEM,
): Promise<void> {
  // Resolve the real home directory path (resolving symlinks)
  let home: string;
  try {
    home = fileSystem.realpathSync(fileSystem.homedir());
  } catch {
    home = fileSystem.homedir();
  }

  for (const token of tokens) {
    if (token.type === "env_var" && token.envVar) {
      process.env[token.envVar] = token.value;
      logger.info({ envVar: token.envVar }, "Set env var %s", token.envVar);
    } else if (token.type === "file" && token.filePath) {
      const resolvedPath = resolve(normalize(token.filePath.replace(/^~/, home)));
      // Only allow writing under the user's home directory
      if (!isUnderHome(resolvedPath, home)) {
        logger.warn({ filePath: resolvedPath }, "Refusing to write token outside home directory");
        continue;
      }

      // Resolve symlinks on the nearest existing ancestor BEFORE creating directories
      // to prevent symlink-based traversal that could escape home
      try {
        let checkPath = dirname(resolvedPath);
        // Walk up until we find an existing ancestor to realpath-check
        while (!fileSystem.existsSync(checkPath) && checkPath !== dirname(checkPath)) {
          checkPath = dirname(checkPath);
        }
        const realAncestor = await fileSystem.realpath(checkPath);
        if (!isUnderHome(realAncestor, home)) {
          logger.warn({ filePath: resolvedPath, realAncestor }, "Parent directory resolves outside home via symlink");
          continue;
        }
      } catch {
        logger.warn({ filePath: resolvedPath }, "Cannot resolve parent directory real path");
        continue;
      }

      try {
        await fileSystem.mkdir(dirname(resolvedPath), { recursive: true });
        await fileSystem.writeFile(resolvedPath, token.value, { mode: 0o600 });
        logger.info({ filePath: resolvedPath }, "Wrote file %s", resolvedPath);
      } catch (err) {
        logger.warn({ filePath: resolvedPath, err }, "Failed to write token file %s, continuing", resolvedPath);
      }
    }
  }
}

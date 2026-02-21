import { writeFile, mkdir, realpath } from "node:fs/promises";
import { dirname, resolve, normalize } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { logger } from "./logger.js";

const envTokens = new Map<string, string>();

/** Return the map of environment variable tokens that have been written to `process.env`. */
export function getEnvTokens(): Map<string, string> {
  return envTokens;
}

/**
 * Verify that a resolved file path is under the user's home directory,
 * accounting for symlinks and case-insensitive filesystems.
 */
function isUnderHome(resolvedPath: string, home: string): boolean {
  // Normalize case for case-insensitive filesystems (Windows, macOS default)
  const normalizedPath = resolvedPath.toLowerCase();
  const normalizedHome = home.toLowerCase();
  return normalizedPath.startsWith(normalizedHome);
}

/** Apply a batch of tokens by setting env vars or writing files under the user's home directory. */
export async function writeTokens(
  tokens: Array<{ name: string; type: string; envVar: string; filePath: string; value: string }>
): Promise<void> {
  // Resolve the real home directory path (resolving symlinks)
  let home: string;
  try {
    home = realpathSync(homedir());
  } catch {
    home = homedir();
  }

  for (const token of tokens) {
    if (token.type === "env_var" && token.envVar) {
      process.env[token.envVar] = token.value;
      envTokens.set(token.envVar, token.value);
      logger.info({ envVar: token.envVar }, "Set env var %s", token.envVar);
    } else if (token.type === "file" && token.filePath) {
      const resolvedPath = resolve(normalize(token.filePath.replace(/^~/, home)));
      // Only allow writing under the user's home directory
      if (!isUnderHome(resolvedPath, home)) {
        logger.warn({ filePath: resolvedPath }, "Refusing to write token outside home directory");
        continue;
      }
      await mkdir(dirname(resolvedPath), { recursive: true });

      // Resolve symlinks on the parent directory BEFORE writing to prevent symlink-based traversal
      try {
        const realParent = await realpath(dirname(resolvedPath));
        if (!isUnderHome(realParent, home)) {
          logger.warn({ filePath: resolvedPath, realParent }, "Parent directory resolves outside home via symlink");
          continue;
        }
      } catch {
        logger.warn({ filePath: resolvedPath }, "Cannot resolve parent directory real path");
        continue;
      }

      await writeFile(resolvedPath, token.value, { mode: 0o600 });

      logger.info({ filePath: resolvedPath }, "Wrote file %s", resolvedPath);
    }
  }
}

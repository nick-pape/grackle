import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, normalize } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

const envTokens = new Map<string, string>();

export function getEnvTokens(): Map<string, string> {
  return envTokens;
}

export async function writeTokens(
  tokens: Array<{ name: string; type: string; envVar: string; filePath: string; value: string }>
): Promise<void> {
  for (const token of tokens) {
    if (token.type === "env_var" && token.envVar) {
      process.env[token.envVar] = token.value;
      envTokens.set(token.envVar, token.value);
      logger.info({ envVar: token.envVar }, "Set env var %s", token.envVar);
    } else if (token.type === "file" && token.filePath) {
      const home = homedir();
      const resolvedPath = resolve(normalize(token.filePath.replace(/^~/, home)));
      // Only allow writing under the user's home directory
      if (!resolvedPath.startsWith(home)) {
        logger.warn({ filePath: resolvedPath }, "Refusing to write token outside home directory");
        continue;
      }
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, token.value, { mode: 0o600 });
      logger.info({ filePath: resolvedPath }, "Wrote file %s", resolvedPath);
    }
  }
}

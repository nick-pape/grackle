import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
      const resolvedPath = token.filePath.replace(/^~/, process.env.HOME || "");
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, token.value, { mode: 0o600 });
      logger.info({ filePath: resolvedPath }, "Wrote file %s", resolvedPath);
    }
  }
}

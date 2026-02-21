import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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
      console.log(`[token-writer] Set env var ${token.envVar}`);
    } else if (token.type === "file" && token.filePath) {
      const resolvedPath = token.filePath.replace(/^~/, process.env.HOME || "");
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, token.value, { mode: 0o600 });
      console.log(`[token-writer] Wrote file ${resolvedPath}`);
    }
  }
}

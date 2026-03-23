import { homedir } from "node:os";
import { join } from "node:path";
import { GRACKLE_DIR } from "@grackle-ai/common";

/**
 * Resolve the root Grackle data directory. Uses `GRACKLE_HOME` env var if set,
 * otherwise falls back to `~/.grackle`. This allows test isolation by pointing
 * to a temp directory.
 */
export const grackleHome: string =
  process.env.GRACKLE_HOME
    ? join(process.env.GRACKLE_HOME, GRACKLE_DIR)
    : join(homedir(), GRACKLE_DIR);

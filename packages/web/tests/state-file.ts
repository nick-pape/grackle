import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const worktreeHash = createHash("md5").update(import.meta.dirname).digest("hex").slice(0, 8);
export const STATE_FILE = join(tmpdir(), `grackle-e2e-state-${worktreeHash}.json`);

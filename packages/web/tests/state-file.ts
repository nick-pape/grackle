import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const worktreeHash = createHash("sha256").update(import.meta.dirname).digest("hex").slice(0, 16);
export const STATE_FILE = join(tmpdir(), `grackle-e2e-state-${worktreeHash}.json`);

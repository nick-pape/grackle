/**
 * Persistence for the AHP `clientId` minted by the server during `initialize`.
 * The client supplies the stored id back on every reconnect so the host can
 * resume in-flight subscriptions.
 *
 * Keyed by an opaque string so a single store can serve multiple connections
 * (e.g., one `ClientIdStore` per `MultiHostClient` keyed by host id).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Persistent storage for AHP client identifiers. */
export interface ClientIdStore {
  /** Returns the stored client id for `key`, or `undefined` if none exists. */
  load(key: string): Promise<string | undefined>;
  /** Persists `clientId` under `key`, replacing any prior value. */
  save(key: string, clientId: string): Promise<void>;
}

/**
 * In-memory store. Suitable for tests and for the lifetime of a single
 * process where persistence across restarts is not required.
 */
export class InMemoryClientIdStore implements ClientIdStore {
  private readonly entries = new Map<string, string>();

  public async load(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }

  public async save(key: string, clientId: string): Promise<void> {
    this.entries.set(key, clientId);
  }
}

/**
 * On-disk store using one file per key under `rootDir`. Writes are atomic
 * via a `.tmp`-then-`rename` pattern, so a crash mid-write can never corrupt
 * a previously-saved value.
 */
export class FileClientIdStore implements ClientIdStore {
  public constructor(private readonly rootDir: string) {}

  public async load(key: string): Promise<string | undefined> {
    try {
      const data = await readFile(this.fileFor(key), "utf8");
      const trimmed = data.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch (err) {
      // ENOENT is the only expected error; anything else is a real problem.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }

  public async save(key: string, clientId: string): Promise<void> {
    const target = this.fileFor(key);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tmp, clientId, "utf8");
    await rename(tmp, target);
  }

  private fileFor(key: string): string {
    // Sanitize: only allow [A-Za-z0-9._-]. Other characters are URL-encoded.
    const safe = key.replace(/[^A-Za-z0-9._-]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
    return join(this.rootDir, `${safe}.clientid`);
  }
}

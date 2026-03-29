import db from "./db.js";
import { settings } from "./schema.js";
import { eq } from "drizzle-orm";

/**
 * Setting keys that clients are allowed to read and write via the public API.
 *
 * Keys outside this set (e.g. credential provider config) are internal and
 * must not be exposed to WebSocket or gRPC callers.
 */
export const WRITABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "default_persona_id",
  "onboarding_completed",
  "webhook_url",
]);

/** Check whether a setting key is allowed for public read/write access. */
export function isAllowedSettingKey(key: string): boolean {
  return WRITABLE_SETTING_KEYS.has(key);
}

/** Retrieve a setting value by key. Returns undefined if the key does not exist. */
export function getSetting(key: string): string | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value;
}

/** Set a setting value by key. Creates or overwrites the value. */
export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

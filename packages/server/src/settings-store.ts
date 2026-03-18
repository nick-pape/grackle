import db from "./db.js";
import { settings } from "./schema.js";
import { eq } from "drizzle-orm";

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

/**
 * Resolve the runtime to pre-install during environment bootstrap.
 *
 * Reads the app-level default persona's runtime so bootstrap installs the
 * runtime the user actually selected, not the hardcoded "claude-code" default
 * stored in the environment column.
 *
 * Falls back to `env.defaultRuntime` when no persona is configured or the
 * persona has no runtime set.
 */
import type { EnvironmentRow } from "@grackle-ai/database";
import { settingsStore, personaStore } from "@grackle-ai/database";

/** Resolve the bootstrap runtime from the default persona, falling back to the env column. */
export function resolveBootstrapRuntime(env: EnvironmentRow): string {
  const defaultPersonaId = settingsStore.getSetting("default_persona_id") || "";
  if (defaultPersonaId) {
    const persona = personaStore.getPersona(defaultPersonaId);
    if (persona?.runtime) {
      return persona.runtime;
    }
  }
  return env.defaultRuntime;
}

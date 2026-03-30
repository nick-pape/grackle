/**
 * @grackle-ai/database — SQLite persistence layer for Grackle.
 *
 * Re-exports schema, stores, migrations, and utility modules so consumers
 * can import everything from a single package entry point.
 */

// ─── Database Lifecycle ────────────────────────────────────
export {
  openDatabase, initDatabase, sqlite, CURRENT_VERSION,
  checkDatabaseIntegrity, backupDatabase,
  walCheckpoint, startWalCheckpointTimer, stopWalCheckpointTimer,
  default as db,
} from "./db.js";
export { seedDatabase } from "./db-seed.js";

// ─── Schema ────────────────────────────────────────────────
export * as schema from "./schema.js";
export type {
  EnvironmentRow,
  NewEnvironment,
  SessionRow,
  NewSession,
  TokenRow,
  WorkspaceRow,
  NewWorkspace,
  TaskRow,
  NewTask,
  FindingRow,
  NewFinding,
  PersonaRow,
  NewPersona,
  ScheduleRow,
  NewSchedule,
  EscalationRow,
  NewEscalation,
  DispatchQueueRow,
  NewDispatchQueueRow,
} from "./schema.js";

// ─── Stores ────────────────────────────────────────────────
export * as sessionStore from "./session-store.js";
export * as taskStore from "./task-store.js";
export * as workspaceStore from "./workspace-store.js";
export * as personaStore from "./persona-store.js";
export * as findingStore from "./finding-store.js";
export * as settingsStore from "./settings-store.js";
export * as envRegistry from "./env-registry.js";
export * as tokenStore from "./token-store.js";
export * as credentialProviders from "./credential-providers.js";
export * as scheduleStore from "./schedule-store.js";
export * as escalationStore from "./escalation-store.js";
export * as dispatchQueueStore from "./dispatch-queue-store.js";

// Re-export key store types for convenience
export type { InsertTaskFields } from "./task-store.js";
export type { TokenConfig } from "./token-store.js";
export type { CredentialProviderConfig, DatabaseInstance } from "./credential-providers.js";
export { isAllowedSettingKey, WRITABLE_SETTING_KEYS } from "./settings-store.js";
export {
  VALID_PROVIDERS,
  VALID_CLAUDE_VALUES,
  VALID_TOGGLE_VALUES,
  parseCredentialProviderConfig,
  isValidCredentialProviderConfig,
} from "./credential-providers.js";

// ─── Event Store ───────────────────────────────────────────
export { persistEvent } from "./event-store.js";
export type { DomainEvent } from "./event-store.js";

// ─── Utilities ─────────────────────────────────────────────
export { grackleHome } from "./paths.js";
export { encrypt, decrypt } from "./crypto.js";
export { safeParseJsonArray } from "./json-helpers.js";
export { slugify } from "./utils/slugify.js";

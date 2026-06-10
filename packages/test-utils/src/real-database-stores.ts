/**
 * Helper for integration tests that use real SQLite (in-memory).
 *
 * Wires all store namespace modules from `@grackle-ai/database` into the
 * store registry via `setDatabaseStores()`. Call after `openDatabase()` +
 * `initDatabase()`, and pair with `clearDatabaseStores()` in `afterAll`.
 */
import {
  sessionStore,
  taskStore,
  envRegistry,
  workspaceStore,
  personaStore,
  agentStore,
  componentStore,
  settingsStore,
  tokenStore,
  credentialProviders,
  scheduleStore,
  escalationStore,
  workspaceEnvironmentLinkStore,
  dispatchQueueStore,
  pluginStore,
  githubAccountStore,
  channelGrantStore,
  persistEvent,
  queryDomainEvents,
  persistStreamMessage,
  queryStreamMessages,
  persistSessionAction,
  querySessionActions,
  setDatabaseStores,
  clearDatabaseStores,
} from "@grackle-ai/database";

/** Wire all real store modules into the DI registry. Call after database init. */
export function initRealDatabaseStores(): void {
  setDatabaseStores({
    sessionStore,
    taskStore,
    envRegistry,
    workspaceStore,
    personaStore,
    agentStore,
    componentStore,
    settingsStore,
    tokenStore,
    credentialProviders,
    scheduleStore,
    escalationStore,
    workspaceEnvironmentLinkStore,
    dispatchQueueStore,
    pluginStore,
    githubAccountStore,
    channelGrantStore,
    eventStore: { persistEvent, queryDomainEvents },
    streamMessageStore: { persistStreamMessage, queryStreamMessages },
    sessionActionStore: { persistSessionAction, querySessionActions },
  });
}

export { clearDatabaseStores };

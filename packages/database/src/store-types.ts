/**
 * Aggregate type bundling all store interfaces for dependency injection.
 *
 * Consumers that need the full database context can accept `DatabaseStores`;
 * consumers needing a narrow slice can `Pick` from it.
 */
import type { SessionStore } from "./session-store.js";
import type { TaskStore } from "./task-store.js";
import type { EnvironmentRegistry } from "./env-registry.js";
import type { WorkspaceStore } from "./workspace-store.js";
import type { PersonaStore } from "./persona-store.js";
import type { AgentStore } from "./agent-store.js";
import type { ComponentStore } from "./component-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { TokenStore } from "./token-store.js";
import type { CredentialProviderStore } from "./credential-providers.js";
import type { ScheduleStore } from "./schedule-store.js";
import type { EscalationStore } from "./escalation-store.js";
import type { WorkspaceEnvironmentLinkStore } from "./workspace-environment-link-store.js";
import type { DispatchQueueStore } from "./dispatch-queue-store.js";
import type { PluginStore } from "./plugin-store.js";
import type { GitHubAccountStore } from "./github-account-store.js";
import type { ChannelGrantStore } from "./channel-grant-store.js";
import type { EventStore } from "./event-store.js";
import type { StreamMessageStore } from "./stream-message-store.js";
import type { SessionActionStore } from "./session-action-store.js";

/** All store interfaces bundled for dependency injection. */
export interface DatabaseStores {
  sessionStore: SessionStore;
  taskStore: TaskStore;
  envRegistry: EnvironmentRegistry;
  workspaceStore: WorkspaceStore;
  personaStore: PersonaStore;
  agentStore: AgentStore;
  componentStore: ComponentStore;
  settingsStore: SettingsStore;
  tokenStore: TokenStore;
  credentialProviders: CredentialProviderStore;
  scheduleStore: ScheduleStore;
  escalationStore: EscalationStore;
  workspaceEnvironmentLinkStore: WorkspaceEnvironmentLinkStore;
  dispatchQueueStore: DispatchQueueStore;
  pluginStore: PluginStore;
  githubAccountStore: GitHubAccountStore;
  channelGrantStore: ChannelGrantStore;
  eventStore: EventStore;
  streamMessageStore: StreamMessageStore;
  sessionActionStore: SessionActionStore;
}

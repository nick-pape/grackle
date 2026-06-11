import { registerAdapter, exec, logger } from "@grackle-ai/core";
import { getDatabaseStores } from "@grackle-ai/database";
import { TunnelRegistry } from "@grackle-ai/adapter-sdk";
import { DockerAdapter } from "@grackle-ai/adapter-docker";
import { LocalAdapter } from "@grackle-ai/adapter-local";
import { SshAdapter } from "@grackle-ai/adapter-ssh";
import { CodespaceAdapter } from "@grackle-ai/adapter-codespace";

/**
 * Register all built-in environment adapters (Docker, Local, SSH, Codespace)
 * with the adapter manager, injecting shared server dependencies.
 *
 * @returns The shared {@link TunnelRegistry} instance for shutdown cleanup.
 */
export function registerAllAdapters(): TunnelRegistry {
  const tunnelRegistry = new TunnelRegistry();
  const adapterDeps = {
    exec,
    logger,
    tunnelRegistry,
    isGitHubProviderEnabled: (): boolean =>
      getDatabaseStores().credentialProviders.getCredentialProviders().github !== "off",
    resolveGitHubToken: (accountId?: string): string | undefined =>
      getDatabaseStores().githubAccountStore.resolveStoredGitHubToken(accountId),
  };

  registerAdapter(new DockerAdapter(adapterDeps));
  registerAdapter(new LocalAdapter());
  registerAdapter(new SshAdapter(adapterDeps));
  registerAdapter(new CodespaceAdapter(adapterDeps));
  return tunnelRegistry;
}

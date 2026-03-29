import { registerAdapter, exec, logger } from "@grackle-ai/core";
import { credentialProviders } from "@grackle-ai/database";
import { DockerAdapter } from "@grackle-ai/adapter-docker";
import { LocalAdapter } from "@grackle-ai/adapter-local";
import { SshAdapter } from "@grackle-ai/adapter-ssh";
import { CodespaceAdapter } from "@grackle-ai/adapter-codespace";

/**
 * Register all built-in environment adapters (Docker, Local, SSH, Codespace)
 * with the adapter manager, injecting shared server dependencies.
 */
export function registerAllAdapters(): void {
  const adapterDeps = {
    exec,
    logger,
    isGitHubProviderEnabled: (): boolean =>
      credentialProviders.getCredentialProviders().github !== "off",
  };

  registerAdapter(new DockerAdapter(adapterDeps));
  registerAdapter(new LocalAdapter());
  registerAdapter(new SshAdapter(adapterDeps));
  registerAdapter(new CodespaceAdapter(adapterDeps));
}

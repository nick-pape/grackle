/**
 * gRPC handlers for the runtime catalog — the AHP root channel's
 * `RootState.agents`. The catalog itself ({@link RUNTIME_CATALOG}) is static,
 * product-level data in `@grackle-ai/common`; this handler composes it with the
 * server-side credential config to advertise each runtime's `protectedResources`
 * (which the host cannot know).
 *
 * @module
 */
import { create } from "@bufbuild/protobuf";
import { grackle, RUNTIME_CATALOG } from "@grackle-ai/common";
import { credentialProviders } from "@grackle-ai/database";
import { deriveCredentialNeeds } from "@grackle-ai/core";

/**
 * List the runtime catalog with per-runtime credential needs resolved against
 * the current credential-provider config (AHP `RootState.agents`).
 */
export async function listRuntimes(): Promise<grackle.ListRuntimesResponse> {
  const config = credentialProviders.getCredentialProviders();
  const runtimes = Object.entries(RUNTIME_CATALOG).map(([provider, entry]) =>
    create(grackle.RuntimeInfoSchema, {
      provider,
      displayName: entry.displayName,
      description: entry.description,
      models: entry.models.map((model) =>
        create(grackle.ModelInfoSchema, {
          id: model.id,
          name: model.name,
          provider: model.provider,
        }),
      ),
      protectedResources: deriveCredentialNeeds(provider, config).map((need) =>
        create(grackle.ProtectedResourceSchema, {
          resource: need.resource,
          resourceName: need.resourceName,
          authorizationServers: need.authorizationServers,
          scopesSupported: need.scopesSupported,
          credentialKinds: need.credentialKinds,
        }),
      ),
    }),
  );
  return create(grackle.ListRuntimesResponseSchema, { runtimes });
}

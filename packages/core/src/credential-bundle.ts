/**
 * Re-export barrel for the credential subsystem.
 *
 * The implementation has been split into focused modules:
 * - {@link ./credential-types.ts} — shared types (`TokenItem`, `ProviderTokenBundle`)
 * - {@link ./credential-needs.ts} — pure needs derivation (`deriveCredentialNeeds`, `RUNTIME_PROVIDERS`)
 * - {@link ./credential-inspector.ts} — pure expiry inspection (`inspectFileCredentialExpiry`)
 * - {@link ./credential-preflight.ts} — pure cross-check (`findUnsatisfiedNeeds`, `formatPreflightCredentialError`)
 * - {@link ./credential-materializer.ts} — side-effectful materialization (`buildProviderTokenBundle`)
 *
 * This barrel preserves the original import path for all consumers and test mocks.
 */
export type { TokenItem, ProviderTokenBundle } from "./credential-types.js";
export {
  RUNTIME_PROVIDERS,
  RUNTIME_REQUIRED_PROVIDER,
  deriveCredentialNeeds,
  findDisabledRequiredProvider,
  type CredentialKind,
  type ProtectedResourceDescriptor,
} from "./credential-needs.js";
export { inspectFileCredentialExpiry, type CredentialExpiryState } from "./credential-inspector.js";
export {
  findUnsatisfiedNeeds,
  formatPreflightCredentialError,
  formatRuntimeProviderDisabledError,
  type UnsatisfiedNeed,
} from "./credential-preflight.js";
export { buildProviderTokenBundle, resolveGitHubTokenFromCli } from "./credential-materializer.js";

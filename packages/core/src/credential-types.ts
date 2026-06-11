/**
 * Shared credential types referenced across the credential subsystem modules.
 * Kept in their own file so pure and side-effectful modules can both import
 * without pulling in each other's dependencies.
 */
import type { CredentialProviderConfig } from "@grackle-ai/database";

/**
 * A single credential token, structurally compatible with both the legacy
 * `powerline.TokenItem` proto message and the AHP-shaped
 * `AuthenticateTokenItem` exported by `@grackle-ai/adapter-sdk`.
 */
export interface TokenItem {
  /** Logical name of the token (e.g. "github-token"). */
  name: string;
  /** Delivery kind ("env_var" or "file"). */
  type: string;
  /** Environment variable name (when `type === "env_var"`). */
  envVar?: string;
  /** Target file path on the remote (when `type === "file"`). */
  filePath?: string;
  /** The credential value. */
  value: string;
  /**
   * The credential-provider block that materialized this token. Server-internal
   * source tag used by {@link findUnsatisfiedNeeds} to decide whether a runtime's
   * advertised needs are met; it is **never delivered** over the wire (the
   * `authenticate` mapper picks only `name`/`type`/`envVar`/`filePath`/`value`).
   */
  provider?: keyof CredentialProviderConfig;
}

/** A bundle of tokens — the return shape of {@link buildProviderTokenBundle}. */
export interface ProviderTokenBundle {
  /** The collected token items, in the order they should be delivered. */
  tokens: TokenItem[];
}
